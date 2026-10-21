import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PermissionPrompt } from './PermissionPrompt';

const req = (toolName: string, input: unknown) => ({
  type: 'permission.request' as const,
  spaceId: 's',
  requestId: 'r',
  toolName,
  input,
});

describe('PermissionPrompt', () => {
  it('renders the ExitPlanMode plan as Markdown', () => {
    render(
      <MantineProvider>
        <PermissionPrompt
          request={req('ExitPlanMode', { plan: '# Plan\n\n- step one' })}
          onReply={() => undefined}
        />
      </MantineProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeTruthy();
    expect(screen.getByText('step one')).toBeTruthy();
  });

  it('shows other tool input as JSON', () => {
    render(
      <MantineProvider>
        <PermissionPrompt
          request={req('Bash', { command: 'ls' })}
          onReply={() => undefined}
        />
      </MantineProvider>,
    );
    expect(screen.getByText(/"command": "ls"/)).toBeTruthy();
  });
});
