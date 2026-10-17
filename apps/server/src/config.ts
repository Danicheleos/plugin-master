import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Config = {
  port: number;
  webOrigins: string[];
  token: string;
  home: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const webPort = env['PM_WEB_PORT'] ?? '4200';
  return {
    port: Number(env['PM_PORT'] ?? 4317),
    webOrigins: [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`],
    token: env['PM_TOKEN'] ?? randomBytes(24).toString('base64url'),
    home: env['PM_HOME'] ?? join(homedir(), '.plugin-master'),
  };
}
