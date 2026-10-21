import { Button, Code, Group, Modal, Stack, Text } from '@mantine/core';

type Props = {
  opened: boolean;
  prompt: string;
  onCancel: () => void;
  onSend: () => void;
};

/** Confirmation before the suite-building prompt goes to the agent; Cancel has the initial focus. */
export function BuildSuiteDialog({ opened, prompt, onCancel, onSend }: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title="Build eval suite with agent?"
      // Mantine focuses the first element with data-autofocus
      trapFocus
    >
      <Stack>
        <Text size="sm">
          This sends a prompt to the agent in the chat. The agent studies the plugin, proposes a plan
          and writes eval cases. It does not run the evals without asking you.
        </Text>
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Prompt
          </Text>
          <Code block mah={140} style={{ overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {prompt}
          </Code>
        </Stack>
        <Group justify="flex-end">
          <Button variant="default" data-autofocus onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSend}>Send to agent</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
