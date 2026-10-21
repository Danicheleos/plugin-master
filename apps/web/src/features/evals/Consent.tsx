import { useState } from 'react';
import { Checkbox, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { configKey, useSpaceConfig } from '../context/hooks';
import { trustEval } from './hooks';

/** "Trust this plugin" box: shown only while the plugin is untrusted; ticking grants trust (no run starts). */
export function TrustCheckbox({ spaceId }: { spaceId: string }) {
  const qc = useQueryClient();
  const trusted = useSpaceConfig(spaceId).data?.evalTrusted;
  const [error, setError] = useState<string | null>(null);
  if (trusted) return null;
  return (
    <>
      <Checkbox
        label="Trust this plugin"
        description="The plugin's skills, hooks and scripts will run on this machine under your account."
        checked={false}
        onChange={() =>
          void trustEval(spaceId)
            .then(() => qc.invalidateQueries({ queryKey: configKey(spaceId) }))
            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        }
      />
      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
    </>
  );
}

export function ScaffoldCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Checkbox
      label="Run scaffold scripts"
      description="Scaffold scripts are author-supplied bash running as you. Only tick this for suites you trust."
      checked={checked}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
  );
}
