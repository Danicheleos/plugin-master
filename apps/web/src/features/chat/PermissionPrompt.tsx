import { Button, Code, Group, Modal } from '@mantine/core';
import type { ServerMessage } from '@pm/protocol';

type Props = {
  request: Extract<ServerMessage, { type: 'permission.request' }>;
  onReply: (allow: boolean) => void;
};

export function PermissionPrompt({ request, onReply }: Props) {
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
      <Code block fz="xs" mah="40vh" data-autofocus tabIndex={-1}>
        {JSON.stringify(request.input, null, 2)}
      </Code>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={() => onReply(false)}>
          Deny
        </Button>
        <Button onClick={() => onReply(true)}>Allow</Button>
      </Group>
    </Modal>
  );
}
