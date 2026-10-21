import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatProvider } from './ChatContext';

vi.mock('./hooks', () => ({
  useChat: () => ({
    permission: {
      type: 'permission.request',
      requestId: 'r',
      toolName: 'Experiment 1 executor: Bash',
      input: {},
    },
    reply: vi.fn(),
  }),
}));

describe('ChatProvider', () => {
  it('shows permission requests without a chat widget', () => {
    render(
      <MantineProvider>
        <ChatProvider spaceId="s">
          <div />
        </ChatProvider>
      </MantineProvider>,
    );
    expect(screen.getByText('Allow Experiment 1 executor: Bash?')).toBeTruthy();
    expect(screen.getAllByText('Allow')).toHaveLength(1);
  });
});
