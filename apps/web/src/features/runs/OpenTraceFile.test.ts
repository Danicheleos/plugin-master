import { describe, expect, it } from 'vitest';
import { groupSessions } from './OpenTraceFile';

const s = (id: string, cwd: string, lastModified: number) => ({ id, title: `t-${id}`, lastModified, cwd, project: cwd.split('/').pop() as string });

describe('groupSessions', () => {
  it('orders projects by newest session and sessions newest first', () => {
    const g = groupSessions([s('a', '/x/old', 10), s('b', '/x/new', 30), s('c', '/x/old', 40), s('d', '/x/new', 20)]);
    expect(g.map((x) => x.name)).toEqual(['old', 'new']);
    expect(g[0]?.sessions.map((i) => i.id)).toEqual(['c', 'a']);
  });
});
