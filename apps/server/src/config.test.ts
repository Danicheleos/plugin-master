import type { networkInterfaces } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { PM_TOKEN: 't', PM_HOME: '/nonexistent-pm-home' };
const entry = (address: string, family: 'IPv4' | 'IPv6', internal = false) =>
  ({ address, family, internal }) as never;
const interfaces: ReturnType<typeof networkInterfaces> = {
  lo0: [entry('127.0.0.1', 'IPv4', true)],
  en0: [entry('fe80::1', 'IPv6'), entry('192.168.1.7', 'IPv4')],
};

describe('loadConfig', () => {
  it('defaults to web port 5100 and loopback only', () => {
    const c = loadConfig(base, interfaces);
    expect(c.webOrigins).toEqual([
      'http://localhost:5100',
      'http://127.0.0.1:5100',
    ]);
    expect(c.hosts).toEqual(['localhost', '127.0.0.1', '[::1]']);
    expect(c.lanIps).toEqual([]);
  });

  it('adds only external IPv4 addresses in LAN mode', () => {
    const c = loadConfig(
      { ...base, PM_LAN: '1', PM_WEB_PORT: '6000' },
      interfaces,
    );
    expect(c.lanIps).toEqual(['192.168.1.7']);
    expect(c.hosts).toContain('192.168.1.7');
    expect(c.hosts).not.toContain('fe80::1');
    expect(c.webOrigins).toContain('http://192.168.1.7:6000');
  });
});
