import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HOOK_EVENTS } from '@pm/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HooksWidget } from './HooksWidget';
import { hooksKey } from './hooks';

vi.mock('../../api/ws', () => ({ useSpaceEvents: vi.fn(), send: vi.fn() }));
const request = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', async (orig) => ({ ...(await orig<object>()), request }));

const listing = {
  events: [...HOOK_EVENTS],
  sources: [
    { source: 'plugin', file: 'hooks/hooks.json', exists: false },
    { source: 'project', file: '.claude/settings.json', exists: true },
    { source: 'local', file: '.claude/settings.local.json', exists: true, error: 'bad json' },
    { source: 'skill', file: 'skills/a/SKILL.md', exists: true },
    { source: 'skill', file: 'skills/b/SKILL.md', exists: true },
  ],
  entries: [
    {
      source: 'project', file: '.claude/settings.json', event: 'PreToolUse', group: 0, matcher: 'Bash',
      handlers: [{ type: 'command', command: 'lint', extra: 1 }, { type: 'http', url: 'http://x' }], problems: [],
    },
    { source: 'project', file: '.claude/settings.json', event: 'Bogus', group: 0, handlers: [], problems: [{ path: 'hooks.Bogus', message: 'Unknown event "Bogus"' }] },
  ],
};

function renderWidget() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(hooksKey('s'), listing);
  render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <HooksWidget spaceId="s" />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => request.mockReset().mockResolvedValue(listing));

// getByRole computes accessible names over the whole matrix and timed out under load; the test
// tsconfig has no DOM lib, hence the local `closest` type
const button = (name: string) =>
  (screen.getByText(name) as HTMLElement & { closest(s: string): HTMLElement | null }).closest('button')!;

describe('HooksWidget', () => {
  it('shows counts, empty cells, flagged rows and broken sources', () => {
    renderWidget();
    expect(screen.getByLabelText('PreToolUse project: 2')).toBeTruthy();
    expect(screen.getByLabelText('PreToolUse plugin: 0')).toBeTruthy();
    expect(screen.getByText('Bogus')).toBeTruthy();
    expect(screen.getAllByText('problem').length).toBe(1);
    expect(screen.getByTitle('.claude/settings.local.json: bad json')).toBeTruthy();
    expect(screen.getByText('2 files')).toBeTruthy();
  });

  it('filters to events with hooks', () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText('Only events with hooks'));
    expect(screen.queryByText('SessionStart')).toBeNull();
    expect(screen.getByText('PreToolUse')).toBeTruthy();
  });

  it('blocks Save on a validation message and saves a valid draft keeping unknown keys', async () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText('PreToolUse project: 2'));
    const save = button('Save');
    expect(save).toHaveProperty('disabled', false);
    fireEvent.change(screen.getAllByLabelText('url')[0], { target: { value: '' } });
    expect(screen.getByText('http handler requires "url"')).toBeTruthy();
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(screen.getAllByLabelText('url')[0], { target: { value: 'http://y' } });
    fireEvent.click(save);
    await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/spaces/s/hooks', {
      source: 'project', file: '.claude/settings.json', event: 'PreToolUse',
      groups: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lint', extra: 1 }, { type: 'http', url: 'http://y' }] }],
    }, expect.anything()));
  });

  it('clears an event after confirmation', async () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText('PreToolUse project: 2'));
    fireEvent.click(button('Clear event'));
    expect(request).not.toHaveBeenCalledWith('PUT', expect.anything(), expect.anything(), expect.anything());
    fireEvent.click(button('Confirm clear'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/spaces/s/hooks',
      { source: 'project', file: '.claude/settings.json', event: 'PreToolUse', groups: [] }, expect.anything()));
  });

  it('disables the matcher for a matcherless event', () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText('Stop project: 0'));
    fireEvent.click(button('Add group'));
    expect(screen.getByLabelText('Matcher')).toHaveProperty('disabled', true);
  });
});
