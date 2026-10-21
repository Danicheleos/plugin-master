import { expect, it, vi } from 'vitest';
import { createPermissions } from './permissions';

it('an already aborted signal denies at once and leaves nothing pending', async () => {
  const broadcast = vi.fn();
  const p = createPermissions(broadcast);
  expect(await p.request('s', 'Bash', {}, AbortSignal.abort())).toBe(false);
  expect(p.pendingFor('s')).toEqual([]);
  expect(broadcast).not.toHaveBeenCalled();
});
