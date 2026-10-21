import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_HOSTS } from './security/guard';
import { loadToken } from './security/token';

export type Config = {
  port: number;
  webOrigins: string[];
  /** Allowed Host header hostnames; defaults to the loopback names. */
  hosts?: string[];
  /** Non-loopback addresses the web server is reachable on (LAN mode only). */
  lanIps?: string[];
  token: string;
  home: string;
  /** Default folder of the folder picker; defaults to os.homedir(). */
  userHome?: string;
};

/** This machine's own external IPv4 addresses. */
function lanAddresses(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string[] {
  return Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  interfaces?: ReturnType<typeof networkInterfaces>,
): Config {
  const webPort = env['PM_WEB_PORT'] ?? '5100';
  const home = env['PM_HOME'] ?? join(homedir(), '.plugin-master');
  const lanIps = env['PM_LAN'] === '1' ? lanAddresses(interfaces) : [];
  return {
    port: Number(env['PM_PORT'] ?? 4317),
    webOrigins: [
      `http://localhost:${webPort}`,
      `http://127.0.0.1:${webPort}`,
      ...lanIps.map((ip) => `http://${ip}:${webPort}`),
    ],
    hosts: [...DEFAULT_HOSTS, ...lanIps],
    lanIps,
    token:
      env['PM_TOKEN'] ?? loadToken(home, Number(env['PM_TOKEN_TTL_DAYS'] ?? 7)),
    home,
  };
}
