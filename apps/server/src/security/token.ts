import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Token persisted in `<home>/token.json` so restarts (dev rebuilds) keep the
 * open UI logged in; a new one is generated when it is older than `ttlDays`.
 */
export function loadToken(
  home: string,
  ttlDays: number,
  now = Date.now(),
): string {
  const file = join(home, 'token.json');
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      token?: unknown;
      createdAt?: unknown;
    };
    if (
      typeof saved.token === 'string' &&
      saved.token.length >= 32 &&
      typeof saved.createdAt === 'number' &&
      now - saved.createdAt < ttlDays * DAY_MS
    )
      return saved.token;
  } catch {
    // missing or broken: rotate
  }
  const token = randomBytes(24).toString('base64url');
  mkdirSync(home, { recursive: true });
  writeFileSync(file, JSON.stringify({ token, createdAt: now }), {
    mode: 0o600,
  });
  return token;
}
