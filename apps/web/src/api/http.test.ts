import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, isNotFound, request } from './http';

const reply = (status: number, body?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
        }),
    ),
  );

afterEach(() => vi.unstubAllGlobals());

describe('request', () => {
  it('validates the response with the schema', async () => {
    reply(200, { a: 1 });
    await expect(
      request('GET', '/x', undefined, z.object({ a: z.number() })),
    ).resolves.toEqual({ a: 1 });
    reply(200, { a: 'one' });
    await expect(
      request('GET', '/x', undefined, z.object({ a: z.number() })),
    ).rejects.toThrow();
  });

  it('a schema needs a body', async () => {
    reply(204);
    await expect(
      request('GET', '/x', undefined, z.object({})),
    ).rejects.toThrow();
  });

  it('void requests ignore the body and accept 204', async () => {
    reply(204);
    await expect(request<void>('DELETE', '/x')).resolves.toBeUndefined();
    reply(200, { ok: true });
    await expect(request<void>('POST', '/x', {})).resolves.toBeUndefined();
  });

  it('throws an ApiError with the server code; isNotFound tells a 404', async () => {
    reply(404, {
      error: { code: 'FILE_NOT_FOUND', message: 'File not found' },
    });
    const e = await request('GET', '/x', undefined, z.unknown()).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe('FILE_NOT_FOUND');
    expect(isNotFound(e)).toBe(true);
    expect(isNotFound(new Error('x'))).toBe(false);
    expect(isNotFound(new ApiError('X', 'x', 500))).toBe(false);
  });
});
