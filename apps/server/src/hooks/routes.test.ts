import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../app';

let tmp: string;
let path: string;
let app: ReturnType<typeof buildApp>;
let url: string;
const headers = { authorization: 'Bearer t' };

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-hooks-'));
  path = join(tmp, 'plug');
  await mkdir(path);
  app = buildApp({ port: 0, webOrigins: [], token: 't', home: join(tmp, 'home') });
  const space = (await app.inject({ method: 'POST', url: '/api/spaces', headers, payload: { path, name: 'plug' } })).json();
  url = `/api/spaces/${space.id}/hooks`;
});
afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const put = async (payload: object) => app.inject({ method: 'PUT', url, headers, payload });
const list = async () => (await app.inject({ url, headers })).json();
const write = async (rel: string, text: string) => {
  await mkdir(dirname(join(path, rel)), { recursive: true });
  await writeFile(join(path, rel), text);
};
const read = (rel: string) => readFile(join(path, rel), 'utf8');
const group = (command: string) => ({ matcher: 'Bash', hooks: [{ type: 'command', command }] });

it('lists all five sources, a broken file and an escaping symlink', async () => {
  await write('hooks/hooks.json', '{"description":"d","hooks":{"Stop":[{"hooks":[{"type":"command","command":"a"}]}]}}');
  await write('.claude/settings.json', '{nope');
  await write('skills/s1/SKILL.md', '---\nname: s1\nhooks:\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: x\n---\nbody\n');
  await write('skills/s2/SKILL.md', 'no frontmatter\n');
  await write('agents/a1.md', '---\nname: a1\nhooks: [1\n---\nbody\n');
  await write('agents/notes.txt', 'ignored');
  await write('outside.md', '---\nhooks: {}\n---\n');
  await mkdir(join(path, 'skills/s3'));
  await symlink(join(path, '../plug-outside.md'), join(path, 'skills/s3/SKILL.md'));
  await write('../plug-outside.md', '---\nhooks: {}\n---\n');
  const res = await list();
  const row = (file: string) => res.sources.find((s: { file: string }) => s.file === file);
  expect(res.events).toContain('PreToolUse');
  expect(row('hooks/hooks.json')).toEqual({ source: 'plugin', file: 'hooks/hooks.json', exists: true });
  expect(row('.claude/settings.json').error).toBeTruthy();
  expect(row('.claude/settings.local.json')).toMatchObject({ source: 'local', exists: false });
  expect(row('agents/a1.md').error).toBeTruthy();
  expect(row('agents/notes.txt')).toBeUndefined();
  expect(row('skills/s2/SKILL.md')).toMatchObject({ source: 'skill', exists: true });
  expect(row('skills/s3/SKILL.md').error).toBeTruthy();
  expect(res.entries.map((e: { source: string; event: string }) => `${e.source}:${e.event}`).sort()).toEqual(['plugin:Stop', 'skill:PreToolUse']);
});

it('honors a plugin.json hooks path inside the space and ignores one outside', async () => {
  await write('.claude-plugin/plugin.json', '{"name":"p","hooks":["./extra/h.json","../x.json"]}');
  await write('extra/h.json', '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"a"}]}]}}');
  const res = await list();
  expect(res.sources.map((s: { file: string }) => s.file)).toContain('extra/h.json');
  expect(res.entries).toHaveLength(1);
  expect((await put({ source: 'plugin', file: '../x.json', event: 'Stop', groups: [] })).statusCode).toBe(400);
  const r = await put({ source: 'plugin', file: 'extra/h.json', event: 'Stop', groups: [] });
  expect(r.statusCode).toBe(200);
  expect(JSON.parse(await read('extra/h.json'))).toEqual({});
});

it('adds, replaces and clears in settings and hooks.json, keeping other keys and style', async () => {
  await write('.claude/settings.json', '{\n    "permissions": {"allow": ["Read"]},\n    "hooks": {"Stop": [{"hooks": [{"type":"command","command":"keep"}]}]}\n}');
  let r = await put({ source: 'project', file: '.claude/settings.json', event: 'PreToolUse', groups: [group('a')] });
  expect(r.statusCode).toBe(200);
  expect(r.json().entries.map((e: { event: string }) => e.event).sort()).toEqual(['PreToolUse', 'Stop']);
  const text = await read('.claude/settings.json');
  expect(text).toContain('\n    "permissions"');
  expect(text.endsWith('}')).toBe(true);
  expect(JSON.parse(text).permissions).toEqual({ allow: ['Read'] });
  await put({ source: 'project', file: '.claude/settings.json', event: 'PreToolUse', groups: [group('b')] });
  expect(JSON.parse(await read('.claude/settings.json')).hooks.PreToolUse[0].hooks[0].command).toBe('b');
  await put({ source: 'project', file: '.claude/settings.json', event: 'PreToolUse', groups: [] });
  expect(Object.keys(JSON.parse(await read('.claude/settings.json')).hooks)).toEqual(['Stop']);

  // new files: parent dirs created, 2-space indent, trailing newline
  r = await put({ source: 'plugin', file: 'hooks/hooks.json', event: 'Stop', groups: [{ hooks: [{ type: 'prompt', prompt: 'p' }] }] });
  expect(r.statusCode).toBe(200);
  expect((await read('hooks/hooks.json')).startsWith('{\n  "hooks"')).toBe(true);
  expect((await read('hooks/hooks.json')).endsWith('}\n')).toBe(true);
  await write('hooks/hooks.json', '{"description":"d","hooks":{}}\n');
  await put({ source: 'plugin', file: 'hooks/hooks.json', event: 'Stop', groups: [{ hooks: [{ type: 'prompt', prompt: 'p' }] }] });
  expect(JSON.parse(await read('hooks/hooks.json')).description).toBe('d');
  await put({ source: 'local', file: '.claude/settings.local.json', event: 'Stop', groups: [{ hooks: [{ type: 'prompt', prompt: 'p' }] }] });
  expect(JSON.parse(await read('.claude/settings.local.json')).hooks.Stop).toHaveLength(1);
  // clearing in a missing file creates nothing
  await put({ source: 'local', file: '.claude/settings.local.json', event: 'Stop', groups: [] });
  expect(JSON.parse(await read('.claude/settings.local.json'))).toEqual({});
  const none = await put({ source: 'project', file: '.claude/settings.json', event: 'Stop', groups: [] });
  expect(none.statusCode).toBe(200);
  expect(await readdir(join(path, '.claude'))).not.toContain(expect.stringMatching(/tmp$/));
});

it('edits frontmatter hooks of skills and agents, keeping body and other keys', async () => {
  const body = '\n# Title\r\n\ttabs   and trailing  \n\n```\n---\nnot fm\n---\n```\n';
  await write('skills/s/SKILL.md', `---\n# a comment\nname: s\ndescription: "A very long description that would be folded by default when the yaml library wraps lines at eighty chars"\nallowed-tools: [Read, Grep]\n---${body}`);
  const g = { hooks: [{ type: 'command', command: 'x', once: true }] };
  let r = await put({ source: 'skill', file: 'skills/s/SKILL.md', event: 'Stop', groups: [g] });
  expect(r.statusCode).toBe(200);
  const text = await read('skills/s/SKILL.md');
  expect(text.endsWith(`---${body}`)).toBe(true);
  expect(text).toContain('# a comment');
  expect(text).toMatch(/allowed-tools: \[ ?Read, Grep ?\]/);
  expect(text).toMatch(/description: "A very long description[^\n]*chars"\n/);
  expect(r.json().entries[0]).toMatchObject({ source: 'skill', event: 'Stop' });
  r = await put({ source: 'skill', file: 'skills/s/SKILL.md', event: 'Stop', groups: [] });
  const cleared = await read('skills/s/SKILL.md');
  expect(cleared).not.toContain('hooks');
  expect(cleared.endsWith(`---${body}`)).toBe(true);
  expect(r.json().entries).toEqual([]);

  // no frontmatter: created; empty frontmatter: filled; clear on none is a no-op
  await write('agents/a.md', '# Agent\nbody');
  await put({ source: 'agent', file: 'agents/a.md', event: 'Stop', groups: [] });
  expect(await read('agents/a.md')).toBe('# Agent\nbody');
  await put({ source: 'agent', file: 'agents/a.md', event: 'Stop', groups: [{ hooks: [{ type: 'command', command: 'c' }] }] });
  expect(await read('agents/a.md')).toMatch(/^---\nhooks:\n {2}Stop:\n[\s\S]*---\n# Agent\nbody$/);
  await write('agents/b.md', '---\n---\nbody\n');
  await put({ source: 'agent', file: 'agents/b.md', event: 'Stop', groups: [{ hooks: [{ type: 'command', command: 'c' }] }] });
  expect((await list()).entries.filter((e: { file: string }) => e.file === 'agents/b.md')).toHaveLength(1);
  expect((await read('agents/b.md')).endsWith('---\nbody\n')).toBe(true);
});

it('rejects invalid groups (422), wrong files (400), traversal and broken files without overwriting', async () => {
  const bad = await put({ source: 'project', file: '.claude/settings.json', event: 'Stop', groups: [{ hooks: [{ type: 'command' }] }] });
  expect(bad.statusCode).toBe(422);
  expect(bad.json().error.message).toContain('groups[0].hooks[0].command');
  await expect(read('.claude/settings.json')).rejects.toThrow();
  for (const [source, file] of [['project', 'package.json'], ['plugin', '.claude/settings.json'], ['skill', 'skills/nope/SKILL.md'], ['agent', 'agents/../x.md'], ['project', '../x.json'], ['local', '/etc/passwd'], ['project', '.claude/settings.json\0']])
    expect((await put({ source, file, event: 'Stop', groups: [] })).statusCode, `${source} ${file}`).toBe(400);
  expect((await put({ source: 'bogus', file: 'x', event: 'Stop', groups: [] })).statusCode).toBe(400);
  await write('.claude/settings.json', '{broken');
  const broken = await put({ source: 'project', file: '.claude/settings.json', event: 'Stop', groups: [{ hooks: [{ type: 'prompt', prompt: 'p' }] }] });
  expect(broken.statusCode).toBe(422);
  expect(await read('.claude/settings.json')).toBe('{broken');
  // a symlinked settings file escaping the space is refused
  await write('../outside.json', '{}');
  await symlink(join(tmp, 'outside.json'), join(path, '.claude/settings.local.json'));
  expect((await put({ source: 'local', file: '.claude/settings.local.json', event: 'Stop', groups: [{ hooks: [{ type: 'prompt', prompt: 'p' }] }] })).statusCode).toBe(400);
  expect(await readFile(join(tmp, 'outside.json'), 'utf8')).toBe('{}');
});

it('serializes concurrent writes to the same file', async () => {
  const events = ['Stop', 'SessionStart', 'Notification', 'PreCompact', 'SessionEnd', 'Setup'];
  const res = await Promise.all(
    events.map((event) => put({ source: 'project', file: '.claude/settings.json', event, groups: [{ hooks: [{ type: 'prompt', prompt: event }] }] })),
  );
  expect(res.map((r) => r.statusCode)).toEqual(events.map(() => 200));
  expect(Object.keys(JSON.parse(await read('.claude/settings.json')).hooks).sort()).toEqual([...events].sort());
});
