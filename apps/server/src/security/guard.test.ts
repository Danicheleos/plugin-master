import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { Config } from '../config';

const config: Config = {
  port: 0,
  webOrigins: ['http://localhost:5100'],
  token: 'secret',
  home: '/nonexistent-pm-home',
};
const auth = { authorization: 'Bearer secret' };

describe('guard', () => {
  const app = buildApp(config);

  it('rejects a foreign Host with 403', async () => {
    const res = await app.inject({
      url: '/api/spaces',
      headers: { ...auth, host: 'evil.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a foreign Origin with 403', async () => {
    const res = await app.inject({
      url: '/api/spaces',
      headers: { ...auth, origin: 'http://evil.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a missing or wrong token with 401', async () => {
    expect((await app.inject({ url: '/api/spaces' })).statusCode).toBe(401);
    const res = await app.inject({
      url: '/api/spaces',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' },
    });
  });

  it('does not let an encoded path bypass the token check', async () => {
    const res = await app.inject({ url: '/%61pi/spaces' });
    expect(res.statusCode).toBe(401);
  });

  it('requires the Bearer prefix', async () => {
    const res = await app.inject({
      url: '/api/spaces',
      headers: { authorization: 'secret' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the unified error format for unknown routes', async () => {
    const res = await app.inject({ url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('allows a valid token on localhost', async () => {
    const res = await app.inject({
      url: '/api/spaces',
      headers: { ...auth, host: 'localhost:4317' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('guard in LAN mode', () => {
  const lan: Config = {
    ...config,
    hosts: ['localhost', '192.168.1.7'],
    webOrigins: [...config.webOrigins, 'http://192.168.1.7:5100'],
  };
  const lanApp = buildApp(lan);
  const host = '192.168.1.7:5100';

  it('accepts the LAN Host and Origin only when enabled', async () => {
    const headers = { ...auth, host, origin: `http://${host}` };
    expect(
      (await lanApp.inject({ url: '/api/spaces', headers })).statusCode,
    ).toBe(200);
    expect(
      (await buildApp(config).inject({ url: '/api/spaces', headers }))
        .statusCode,
    ).toBe(403);
  });

  it('still rejects foreign Host and Origin, and a missing token', async () => {
    const get = (headers: Record<string, string>) =>
      lanApp.inject({ url: '/api/spaces', headers }).then((r) => r.statusCode);
    expect(await get({ ...auth, host: 'evil.com' })).toBe(403);
    expect(await get({ ...auth, host, origin: 'http://evil.com' })).toBe(403);
    expect(await get({ host })).toBe(401);
  });
});
