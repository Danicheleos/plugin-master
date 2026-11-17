import { useEffect, useRef, useState } from 'react';
import {
  Anchor,
  Button,
  Collapse,
  Group,
  Loader,
  Progress,
  Select,
  Text,
} from '@mantine/core';
import type { Plan, Phase } from '@pm/protocol';
import { ContextMeter } from './AgentStats';
import { NewPlanDialog } from './NewPlanDialog';
import { planPath, usePlans, useSetActivePlan } from './hooks';
import type { AgentStats } from '../chat';
import styles from './plans.module.scss';

const ICON: Record<Phase['status'], string> = {
  done: '✓',
  in_progress: '●',
  pending: '○',
  skipped: '–',
};

type Props = {
  spaceId: string;
  stats: AgentStats;
  /** Sends a chat message to the master agent. */
  onAsk: (text: string) => void;
};

export function PlanPanel({ spaceId, stats, onAsk }: Props) {
  const { data, error, isPending } = usePlans(spaceId);
  const setActive = useSetActivePlan(spaceId);
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);

  const plans = data?.plans ?? [];
  const active = plans.find((p) => p.id === data?.active);

  return (
    <div className={styles.panel}>
      {stats.master && (
        <div className={styles.meter}>
          <ContextMeter usage={stats.master} />
        </div>
      )}
      {active && <PlanProgress plan={active} />}
      <Group gap="xs" wrap="nowrap">
        <Select
          size="xs"
          flex={1}
          aria-label="Active plan"
          placeholder={
            isPending
              ? 'Loading plans…'
              : plans.length
                ? 'No active plan'
                : 'No plans yet'
          }
          data={plans.map((p) => ({
            value: p.id,
            label: `${p.status === 'done' ? '✓ ' : ''}${planPath(p, plans)}`,
          }))}
          value={data?.active ?? null}
          onChange={(id) => setActive.mutate(id)}
          allowDeselect={false}
        />
        {active && (
          <Button
            size="compact-sm"
            variant="subtle"
            title="Work without a plan; the plan is kept and can be picked again"
            onClick={() => setActive.mutate(null)}
          >
            Detach
          </Button>
        )}
        <Button
          size="compact-sm"
          variant="default"
          onClick={() => setCreating(true)}
        >
          New plan
        </Button>
        <Button
          size="compact-sm"
          variant="subtle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      </Group>
      <Collapse expanded={open}>
        <div className={styles.body}>
          {error && (
            <Text size="xs" c="red">
              Failed to load plans: {error.message}
            </Text>
          )}
          {active ? (
            <ActivePlan
              key={active.id}
              plan={active}
              plans={plans}
              current={stats.current}
              onSwitch={(id) => setActive.mutate(id)}
            />
          ) : isPending ? (
            <Loader size="xs" aria-label="Loading plans" />
          ) : (
            <Text size="xs" c="dimmed">
              No active plan
            </Text>
          )}
        </div>
      </Collapse>
      {creating && (
        <NewPlanDialog
          spaceId={spaceId}
          onClose={() => setCreating(false)}
          onAsk={onAsk}
        />
      )}
    </div>
  );
}

function PlanProgress({ plan }: { plan: Plan }) {
  const done = plan.phases.filter(
    (p) => p.status === 'done' || p.status === 'skipped',
  ).length;
  const total = plan.phases.length;
  const index = plan.phases.findIndex((p) => p.status === 'in_progress');
  return (
    <Group gap="xs" wrap="nowrap" className={styles.meter}>
      <Progress
        flex={1}
        size="sm"
        value={total ? (done / total) * 100 : 0}
        aria-label="Plan progress"
      />
      <Text size="xs">
        {total === 0
          ? 'No phases'
          : index >= 0
            ? `Phase ${index + 1} of ${total}`
            : `${done} of ${total} done`}
      </Text>
    </Group>
  );
}

type ActiveProps = {
  plan: Plan;
  plans: Plan[];
  current: string | null;
  onSwitch: (id: string) => void;
};

function ActivePlan({ plan, plans, current, onSwitch }: ActiveProps) {
  const [logOpen, setLogOpen] = useState(false);
  const lastLog = plan.log[plan.log.length - 1]?.message;
  const ancestors = planPath(plan, plans).split(' › ').slice(0, -1);
  return (
    <>
      {ancestors.length > 0 && (
        <Text size="xs" c="dimmed">
          {ancestors.join(' › ')} ›
        </Text>
      )}
      <Text size="sm" fw={600}>
        {plan.title}
      </Text>
      {plan.goal && (
        <Text size="xs" c="dimmed" lineClamp={2}>
          {plan.goal}
        </Text>
      )}
      <PhaseList key={plan.id} plan={plan} onSwitch={onSwitch} />
      <Text size="xs">Now: {current ?? lastLog ?? 'idle'}</Text>
      <Anchor
        component="button"
        type="button"
        size="xs"
        onClick={() => setLogOpen((o) => !o)}
      >
        {logOpen ? 'Hide log' : `Log (${plan.log.length})`}
      </Anchor>
      {logOpen && (
        <ul className={styles.log}>
          {[...plan.log].reverse().map((l, i) => (
            <li key={i}>
              {new Date(l.at).toLocaleTimeString()} {l.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PhaseList({
  plan,
  onSwitch,
}: {
  plan: Plan;
  onSwitch: (id: string) => void;
}) {
  // Manual toggles per phase; without one a phase is open iff in progress.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  // a phase's log lines stay folded until asked for
  const [logFor, setLogFor] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLUListElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);
  const currentId = plan.phases.find((p) => p.status === 'in_progress')?.id;

  useEffect(() => {
    const list = listRef.current;
    const row = currentRef.current;
    if (!list || !row) return;
    list.scrollTop = Math.max(0, row.offsetTop - list.offsetTop);
  }, [plan.id, currentId]);

  return (
    <ul className={styles.phases} ref={listRef}>
      {plan.phases.map((p) => {
        const expanded = toggled[p.id] ?? p.status === 'in_progress';
        const lines = plan.log.filter((l) => l.phaseId === p.id);
        return (
          <li
            key={p.id}
            data-status={p.status}
            ref={p.id === currentId ? currentRef : undefined}
          >
            <button
              type="button"
              className={styles.phaseRow}
              aria-expanded={expanded}
              onClick={() =>
                setToggled((t) => ({
                  ...t,
                  [p.id]: !(t[p.id] ?? p.status === 'in_progress'),
                }))
              }
            >
              <span className={styles.chevron} aria-hidden>
                {expanded ? '▾' : '▸'}
              </span>
              <span aria-hidden>{ICON[p.status]}</span>
              <span className={styles.phaseId}>{p.id}</span>
              <span
                className={expanded ? styles.phaseTitleFull : styles.phaseTitle}
              >
                {p.title}
              </span>
            </button>
            {expanded && (p.childPlanId || lines.length > 0) && (
              <div className={styles.phaseDetail}>
                {lines.length > 0 && (
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    onClick={() =>
                      setLogFor((l) => ({ ...l, [p.id]: !l[p.id] }))
                    }
                  >
                    {logFor[p.id] ? 'Hide log' : `Log (${lines.length})`}
                  </Anchor>
                )}
                {lines.length > 0 && logFor[p.id] && (
                  <ul className={styles.log}>
                    {lines.map((l, i) => (
                      <li key={i}>
                        {new Date(l.at).toLocaleTimeString()} {l.message}
                      </li>
                    ))}
                  </ul>
                )}
                {p.childPlanId && (
                  <Anchor
                    component="button"
                    type="button"
                    size="sm"
                    onClick={() => onSwitch(p.childPlanId as string)}
                  >
                    child plan
                  </Anchor>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
