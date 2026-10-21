import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileKey } from '../files/hooks';
import { SkillsWidget } from './SkillsWidget';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', async (orig) => ({ ...(await orig<object>()), request }));

const PATH = 'skills/demo/SKILL.md';
const SKILL = `---
name: demo
description: Demo skill
license: MIT
when_to_use: Whenever
---
Intro, see references/missing.md.

# Alpha
alpha body

## Alpha child
child body

# Beta
beta body
`;

const dir = (name: string) => ({ name, path: `skills/${name}`, type: 'dir' });
const file = (name: string, parent: string) => ({ name, path: `${parent}/${name}`, type: 'file' });

let created: string[] = [];
function route(method: string, url: string, body?: { path: string }) {
  if (method === 'POST') created.push(body!.path.split('/')[1]);
  if (method !== 'GET') return Promise.resolve();
  const q = decodeURIComponent(url.split('=').slice(1).join('='));
  if (url.includes('/file?')) return Promise.resolve({ path: q, content: SKILL });
  const tree: Record<string, unknown[]> = {
    skills: [dir('demo'), dir('other'), ...created.map(dir)],
    ...Object.fromEntries(created.map((n) => [`skills/${n}`, [file('SKILL.md', `skills/${n}`)]])),
    'skills/demo': [file('SKILL.md', 'skills/demo')],
    'skills/other': [file('SKILL.md', 'skills/other')],
  };
  return Promise.resolve(tree[q] ?? []);
}

let qc: QueryClient;
async function renderWidget() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <SkillsWidget spaceId="s" />
      </MantineProvider>
    </QueryClientProvider>,
  );
  await screen.findByLabelText('Edit Alpha');
}

const writes = () => request.mock.calls.filter((c) => c[0] !== 'GET');
const click = (label: string) => fireEvent.click(screen.getByLabelText(label));

beforeEach(() => {
  created = [];
  request.mockReset().mockImplementation(route);
});

describe('SkillsWidget', () => {
  it('renders the outline with sizes and the frontmatter', async () => {
    await renderWidget();
    expect(screen.getByText('Alpha child')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Preamble')).toBeTruthy();
    expect(screen.getByText('Demo skill', { exact: false })).toBeTruthy();
  });

  it('edits one block and saves only that slice', async () => {
    await renderWidget();
    click('Edit Alpha');
    fireEvent.change(screen.getByLabelText('Text of Alpha'), { target: { value: '# Alpha\nalpha NEW\n\n' } });
    fireEvent.click(screen.getByText('Apply'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(['PUT', '/api/spaces/s/file', { path: PATH, content: SKILL.replace('alpha body', 'alpha NEW') }]);
  });

  it('moves a block down with its children', async () => {
    await renderWidget();
    click('Move down Alpha');
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const text = writes()[0][2].content as string;
    expect(text.indexOf('# Beta')).toBeLessThan(text.indexOf('# Alpha'));
    expect(text.indexOf('# Alpha')).toBeLessThan(text.indexOf('## Alpha child'));
  });

  it('extracts a block to a sub-file, then saves the link', async () => {
    await renderWidget();
    click('Move Beta to sub-file');
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[0]).toEqual(['POST', '/api/spaces/s/file', { path: 'skills/demo/references/beta.md', content: 'beta body\n' }]);
    expect(writes()[1][0]).toBe('PUT');
    expect(writes()[1][2].content).toContain('See [Beta](references/beta.md).');
  });

  it('lints the draft', async () => {
    await renderWidget();
    expect(screen.getByText('Claude Code only, not portable to claude.ai/Skills API')).toBeTruthy();
    expect(await screen.findByText('Referenced file not found: references/missing.md')).toBeTruthy();
    expect(screen.getByText(/tokens \(estimate\)/)).toBeTruthy();
  });

  it('shows a conflict banner when the file changes on disk under unsaved edits', async () => {
    await renderWidget();
    click('Delete Beta');
    fireEvent.click(screen.getByText('Delete', { selector: 'button, button *' }));
    act(() => qc.setQueryData(fileKey('s', PATH), { path: PATH, content: `${SKILL}more\n` }));
    expect(await screen.findByText('File changed on disk')).toBeTruthy();
    fireEvent.click(screen.getByText('Overwrite'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][2].content).not.toContain('# Beta');
  });

  it('validates the name of a new skill', async () => {
    await renderWidget();
    fireEvent.click(screen.getByText('New skill'));
    const name = await screen.findByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Bad_Name' } });
    expect(screen.getByText('Only lowercase letters, digits and hyphens')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'demo' } });
    expect(screen.getByText('Skill "demo" already exists')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'x'.repeat(65) } });
    expect(screen.getByText('Name is 65 chars, max 64')).toBeTruthy();
    fireEvent.click(screen.getByText('Create'));
    expect(writes()).toHaveLength(0);
  });

  it('creates a new skill and selects it', async () => {
    await renderWidget();
    fireEvent.click(screen.getByText('New skill'));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'new-one' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Does: things' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual([
      'POST',
      '/api/spaces/s/file',
      {
        path: 'skills/new-one/SKILL.md',
        content: '---\nname: new-one\ndescription: "Does: things"\n---\n\n# new-one\n\nDescribe what the skill does and how.\n',
      },
    ]);
    expect(await screen.findByDisplayValue('new-one')).toBe(screen.getByLabelText('Skill'));
  });
});
