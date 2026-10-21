import { Button, Code, Group, Modal } from '@mantine/core';
import Markdown from 'react-markdown';
import type { ServerMessage } from '@pm/protocol';

type Props = {
  request: Extract<ServerMessage, { type: 'permission.request' }>;
  onReply: (allow: boolean) => void;
};

export function PermissionPrompt({ request, onReply }: Props) {
  const plan = (request.input as { plan?: unknown } | null)?.plan;
  return (
    <Modal
      opened
      onClose={() => onReply(false)}
      title={`Allow ${request.toolName}?`}
      size="lg"
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      {request.toolName === 'ExitPlanMode' && typeof plan === 'string' ? (
        <div
          style={{ maxHeight: '50vh', overflow: 'auto' }}
          data-autofocus
          tabIndex={-1}
        >
          <Markdown>{plan}</Markdown>
        </div>
      ) : (
        <Code block fz="xs" mah="40vh" data-autofocus tabIndex={-1}>
          {JSON.stringify(request.input, null, 2)}
        </Code>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={() => onReply(false)}>
          Deny
        </Button>
        <Button onClick={() => onReply(true)}>Allow</Button>
      </Group>
    </Modal>
  );
}
