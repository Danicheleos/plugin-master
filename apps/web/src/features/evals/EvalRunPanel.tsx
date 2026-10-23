import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Autocomplete,
  Badge,
  Button,
  Checkbox,
  CloseButton,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Stack,
  Text,
} from '@mantine/core';
import type { EvalRunRequest, EvalState, EvalSuite } from '@pm/protocol';
import {
  cancelEval,
  startEval,
  useEvalLive,
  useEvalRuns,
  useEvalSuite,
} from './hooks';
import { EvalProgressView } from './EvalProgressView';
import { ExternalSeriesView } from './ExternalSeriesView';
import { useEvalPrefs } from './prefs';
import { ScaffoldCheckbox, TrustCheckbox } from './Consent';
import styles from './evals.module.scss';

const GATED_TOOLS = ['Bash', 'Write', 'Edit', 'WebFetch'];
const MODEL_ALIASES = ['haiku', 'sonnet', 'opus'];

const COLORS: Record<EvalState, string> = {
  idle: 'gray',
  running: 'blue',
  done: 'green',
  failed: 'red',
  cancelled: 'yellow',
};

type Props = {
  spaceId: string;
  onDone: (runId: string) => void;
  /** Extra controls on the same row as "Run evals". */
  actions?: ReactNode;
};

export function EvalRunPanel({ spaceId, onDone, actions }: Props) {
  const { status, lines } = useEvalLive(spaceId, onDone);
  const [form, setForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a finished run's badge, progress and output can be dismissed; the next run shows them again
  const [hidden, setHidden] = useState(false);
  const pane = useRef<HTMLPreElement>(null);
  const running = status.state === 'running';
  const suite = useEvalSuite(spaceId).data;
  const runs = useEvalRuns(spaceId).data;
  const groups = runs?.groups;
  const models = [
    ...new Set([
      ...MODEL_ALIASES,
      ...(groups ?? []).flatMap((g) =>
        g.modelOverride ? [g.modelOverride] : [],
      ),
    ]),
  ];

  useEffect(() => {
    if (running) setHidden(false);
  }, [running]);

  useEffect(() => {
    pane.current?.scrollTo({ top: pane.current.scrollHeight });
  }, [lines]);

  async function run(req: EvalRunRequest) {
    setError(null);
    try {
      await startEval(spaceId, req);
      setForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Stack gap="xs" mb="sm">
      <Group>
        <Button size="xs" disabled={running} onClick={() => setForm(true)}>
          Run evals
        </Button>
        {status.state !== 'idle' && !hidden && (
          <Badge color={COLORS[status.state]}>
            {status.state}
            {status.exitCode !== undefined && ` (exit ${status.exitCode})`}
          </Badge>
        )}
        {running && (
          <Button
            size="xs"
            color="red"
            variant="light"
            onClick={() => void cancelEval(spaceId).catch(() => undefined)}
          >
            Cancel
          </Button>
        )}
        {error && (
          <Group gap={4} wrap="nowrap">
            <Text c="red" size="sm">
              {error}
            </Text>
            <CloseButton
              size="sm"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
            />
          </Group>
        )}
        {status.state !== 'idle' && !running && !hidden && (
          <CloseButton
            size="sm"
            aria-label="Hide result"
            onClick={() => setHidden(true)}
          />
        )}
        {actions}
      </Group>
      {runs?.external && (
        <ExternalSeriesView spaceId={spaceId} series={runs.external} />
      )}
      {status.progress && !hidden && (
        <EvalProgressView progress={status.progress} />
      )}
      {status.state !== 'idle' && !hidden && (
        <pre ref={pane} className={styles.output}>
          {lines.map((l, i) => (
            <div
              key={i}
              className={l.stream === 'stderr' ? styles.stderr : undefined}
            >
              {l.line}
            </div>
          ))}
        </pre>
      )}
      <RunForm
        opened={form}
        onClose={() => setForm(false)}
        onRun={run}
        error={error}
        suite={suite}
        models={models}
        spaceId={spaceId}
      />
    </Stack>
  );
}

type FormProps = {
  opened: boolean;
  onClose: () => void;
  onRun: (req: EvalRunRequest) => Promise<void>;
  error: string | null;
  suite?: EvalSuite;
  models?: string[];
  /** Shows the trust checkbox while the plugin is untrusted. */
  spaceId?: string;
};

export function RunForm({
  opened,
  onClose,
  onRun,
  error,
  suite,
  models = MODEL_ALIASES,
  spaceId,
}: FormProps) {
  // form values persist per widget; the scaffold consent never does
  const [{ form }, update] = useEvalPrefs();
  const { cases, tags, runs, cost, model, ablation, allowTools } = form;
  const set = (patch: Partial<typeof form>) =>
    update((p) => ({ form: { ...p.form, ...patch } }));
  const [scaffold, setScaffold] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    void onRun({
      maxCostUsd: Number(cost),
      ...(cases.length && { cases }),
      ...(tags.length && { tags }),
      ...(runs !== '' && { runs: Number(runs) }),
      ...(model && { model }),
      ...(ablation && { ablation }),
      ...(allowTools.length && { allowTools }),
      ...(scaffold && { scaffold }),
    });
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Run evals">
      <form onSubmit={submit}>
        <Stack>
          <MultiSelect
            label="Cases"
            placeholder={cases.length ? undefined : 'All cases'}
            searchable
            clearable
            data={[...new Set((suite?.cases ?? []).map((c) => c.name))]}
            value={cases}
            onChange={(cases) => set({ cases })}
          />
          <MultiSelect
            label="Tags"
            placeholder={tags.length ? undefined : 'Any tag'}
            searchable
            clearable
            data={suite?.tags ?? []}
            value={tags}
            onChange={(tags) => set({ tags })}
          />
          <NumberInput
            label="Runs per case"
            min={1}
            max={50}
            allowDecimal={false}
            value={runs}
            onChange={(v) => set({ runs: String(v) })}
          />
          <NumberInput
            label="Cost limit (USD)"
            required
            min={0.01}
            value={cost}
            onChange={(v) => set({ cost: String(v) })}
          />
          <Autocomplete
            label="Model"
            placeholder="Default"
            data={models}
            value={model}
            onChange={(model) => set({ model })}
          />
          <Checkbox
            label="Compare with a no-plugin baseline (about 2x cost)"
            checked={ablation}
            onChange={(e) => set({ ablation: e.currentTarget.checked })}
          />
          <MultiSelect
            label="Grant tools to cases"
            description="A case's allowed_tools never grants Bash, Write or Edit by itself; grant them here (runs sandboxed)."
            placeholder={allowTools.length ? undefined : 'None'}
            clearable
            data={GATED_TOOLS}
            value={allowTools}
            onChange={(allowTools) => set({ allowTools })}
          />
          <ScaffoldCheckbox checked={scaffold} onChange={setScaffold} />
          {spaceId && <TrustCheckbox spaceId={spaceId} />}
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Group justify="flex-end">
            <Button type="submit" disabled={!(Number(cost) > 0)}>
              Start
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
