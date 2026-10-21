import { useState } from 'react';
import { Button, Group, Modal, NumberInput, Stack, Text } from '@mantine/core';
import { splitTriggerCases, HOLDOUT_TAG, TRIGGER_TAG } from '@pm/protocol';
import { useEvalSuite } from '../evals/hooks';
import { ApiAlert } from '../experiments/ApiAlert';
import { useRunExperiment } from '../experiments/hooks';

function Form({ spaceId, skill, onClose }: { spaceId: string; skill: string; onClose: () => void }) {
  const [maxCost, setMaxCost] = useState<number | string>(2);
  const [iterations, setIterations] = useState<number | string>(3);
  const suite = useEvalSuite(spaceId);
  const run = useRunExperiment(spaceId);
  const { train, holdout } = splitTriggerCases(suite.data?.cases ?? []);
  const valid =
    typeof maxCost === 'number' && maxCost > 0 && maxCost <= 20 &&
    typeof iterations === 'number' && iterations >= 1 && iterations <= 5 && train.length > 0;
  const started = run.data;
  return (
    <Modal opened onClose={onClose} title={`Optimize description: ${skill}`}>
      <Stack
        gap="xs"
        component="form"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (valid) run.mutate({ kind: 'description', skill, maxCostUsd: maxCost as number, iterations: iterations as number });
        }}
      >
        <Text size="sm">
          Trigger cases: <b>{train.length}</b> train, <b>{holdout.length}</b> holdout.
        </Text>
        <Text size="xs" c="dimmed">
          Tag eval cases that should (or should not) trigger this skill with "{TRIGGER_TAG}"; also tag some with
          "{HOLDOUT_TAG}" to keep them out of the optimization and check for overfitting. Without holdout cases the
          result is "unknown".
        </Text>
        {suite.data && train.length === 0 && <Text size="sm" c="red">Add at least one "{TRIGGER_TAG}" case first.</Text>}
        <Group align="flex-start" wrap="nowrap">
          <NumberInput label="Max cost (USD)" size="xs" w={130} min={0} max={20} step={0.5} decimalScale={2}
            value={maxCost} onChange={setMaxCost} error={typeof maxCost === 'number' && maxCost > 0 && maxCost <= 20 ? undefined : 'Enter 0 to 20'} />
          <NumberInput label="Iterations" size="xs" w={100} min={1} max={5} allowDecimal={false}
            value={iterations} onChange={setIterations} error={typeof iterations === 'number' && iterations >= 1 && iterations <= 5 ? undefined : '1 to 5'} />
        </Group>
        {run.error && <ApiAlert error={run.error} />}
        {started && <Text size="sm" c="green">Started experiment {started.id}. Follow it in the Experiments widget.</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Close</Button>
          <Button type="submit" disabled={!valid || !!started} loading={run.isPending}>Start</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** "Optimize description" button of a skill; the form opens in a modal. */
export function OptimizeDescription({ spaceId, skill }: { spaceId: string; skill: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="default" onClick={() => setOpen(true)}>Optimize description</Button>
      {open && <Form spaceId={spaceId} skill={skill} onClose={() => setOpen(false)} />}
    </>
  );
}
