import { describe, expect, it } from 'vitest';
import {
  ago,
  bytes,
  clock,
  cost,
  delta,
  deltaCi,
  duration,
  elapsedMs,
  seconds,
  shortHash,
  signed,
  tokens,
} from './index';

describe('format', () => {
  it('formats durations, seconds and a stopwatch', () => {
    expect(duration(undefined)).toBe('-');
    expect(duration(45)).toBe('45s');
    expect(duration(150)).toBe('3m');
    expect(seconds(90_000)).toBe('2m');
    expect(clock(65_000)).toBe('1:05');
    expect(clock(3_725_000)).toBe('1:02:05');
    expect(clock(-5)).toBe('0:00');
  });

  it('formats cost with 2 decimals, or as many as asked', () => {
    expect(cost(undefined)).toBe('-');
    expect(cost(0.5)).toBe('$0.50');
    expect(cost(0.12345, 4)).toBe('$0.1235');
  });

  it('formats signed changes', () => {
    expect(signed(1.5, (n) => String(n))).toBe('+1.5');
    expect(signed(-1.5, (n) => String(n))).toBe('-1.5');
    expect(signed(0)).toBe('0.00');
    expect(signed(undefined)).toBe('-');
    expect(delta(0.125)).toBe('+0.13');
    expect(deltaCi(0.1, [-0.05, 0.3])).toBe('+0.10 [-0.05, +0.30]');
  });

  it('formats sizes, tokens and spans', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(tokens(12_345)).toBe('12k');
    expect(elapsedMs('2026-01-01T00:00:00Z', '2026-01-01T00:00:02Z')).toBe(
      2000,
    );
    expect(elapsedMs('2026-01-01T00:00:00Z')).toBeUndefined();
  });

  it('shortens hashes', () => {
    expect(shortHash('abcdef123456')).toBe('abcdef1');
    expect(shortHash(undefined)).toBeUndefined();
  });

  it('says how long ago something was (one scale for runs and commits)', () => {
    const now = Date.parse('2026-01-10T12:00:00Z');
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(ago(at(30_000), now)).toBe('just now');
    expect(ago(at(5 * 60_000), now)).toBe('5m ago');
    expect(ago(at(3 * 3600_000 + 5000), now)).toBe('3h ago');
    expect(ago(at(2 * 86400_000), now)).toBe('2d ago');
    expect(ago(at(-60_000), now)).toBe('just now'); // clock skew
    expect(ago('nope', now)).toBe('');
  });
});
