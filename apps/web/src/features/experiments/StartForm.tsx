import { useState } from 'react';
import { Button, Group, MultiSelect, NumberInput, Stack, Textarea } from '@mantine/core';
import { ScaffoldCheckbox, TrustCheckbox } from '../evals/Consent';
import { useEvalSuite } from '../evals/hooks';
import { ApiAlert } from './ApiAlert';
import { useRunExperiment } from './hooks';

/** Starts one loop run: cost cap (required), optional focus and cases. */
export function StartForm({ spaceId }: { spaceId: string }) {
  const [maxCost, setMaxCost] = useState<number | string>(2);
  const [focus, setFocus] = useState('');
  const [cases, setCases] = useState<string[]>([]);
  const [scaffold, setScaffold] = useState(false);
  const suite = useEvalSuite(spaceId).data;
  const run = useRunExperiment(spaceId);
  const valid = typeof maxCost === 'number' && maxCost > 0 && maxCost <= 20;
  return (
    <Stack
      gap="xs"
      p="xs"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (valid)
          run.mutate({
            maxCostUsd: maxCost,
            ...(focus.trim() ? { focus: focus.trim() } : {}),
            ...(cases.length ? { cases } : {}),
            ...(scaffold ? { scaffold } : {}),
          });
      }}
    >
      <Group align="flex-start" wrap="nowrap">
        <NumberInput
          label="Max cost (USD)"
          size="xs"
          w={130}
          min={0}
          max={20}
          step={0.5}
          decimalScale={2}
          value={maxCost}
          onChange={setMaxCost}
          error={valid ? undefined : 'Enter 0 to 20'}
        />
        <MultiSelect
          label="Cases (all if none)"
          size="xs"
          flex={1}
          data={(suite?.cases ?? []).map((c) => c.name)}
          value={cases}
          onChange={setCases}
          searchable
        />
      </Group>
      <Textarea label="Focus (optional)" size="xs" rows={2} value={focus} onChange={(e) => setFocus(e.target.value)} />
      <ScaffoldCheckbox checked={scaffold} onChange={setScaffold} />
      <TrustCheckbox spaceId={spaceId} />
      {run.error && <ApiAlert error={run.error} />}
      <Button type="submit" size="xs" disabled={!valid} loading={run.isPending} w="fit-content">
        Run experiment
      </Button>
    </Stack>
  );
}
