import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('chokidar', async () => {
  const { EventEmitter: EE } = await import('node:events');
  return {
    watch: () => {
      const w = Object.assign(new EE(), {
        add: vi.fn(),
        unwatch: vi.fn(),
        close: vi.fn(async () => undefined),
      });
      fake.current = w;
      return w;
    },
  };
});

import { watchSpaces } from './watcher';

describe('watcher errors', () => {
  it('passes watcher errors to onError instead of throwing', async () => {
    let handler: (m: unknown, c: unknown) => Promise<void> = async () =>
      undefined;
    const hub = {
      on: (_t: string, h: typeof handler) => (handler = h),
      onLeave: () => undefined,
      broadcast: () => undefined,
    };
    const registry = { get: async () => ({ path: process.cwd() }) };
    const onError = vi.fn();
    const w = watchSpaces(hub as never, registry as never, onError);
    await handler({ spaceId: 's', paths: [''] }, {});
    const err = Object.assign(new Error('EMFILE: too many open files'), {
      code: 'EMFILE',
    });
    expect(() =>
      (fake.current as EventEmitter).emit('error', err),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledWith(err);
    await w.close();
  });
});
