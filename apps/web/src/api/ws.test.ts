import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Minimal WebSocket stand-in: records every instance; the test opens/closes them by hand. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const live = () => FakeSocket.all.filter((s) => s.readyState !== 3);

/** A fresh module: its socket state is module-level. */
async function load() {
  vi.resetModules();
  return import('./ws');
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ws client', () => {
  it('keeps one socket when a message is sent while a reconnect is pending', async () => {
    const { send } = await load();
    send({ type: 'subscribe', spaceId: 's1' });
    FakeSocket.all[0].open();
    FakeSocket.all[0].close();
    send({ type: 'chat.send', spaceId: 's1', text: 'hi' }); // in the reconnect gap
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(2);
    expect(live()).toHaveLength(1);
  });

  it('replays queued messages, then subscriptions, once on reconnect', async () => {
    const { send } = await load();
    send({ type: 'subscribe', spaceId: 's1' });
    FakeSocket.all[0].open();
    FakeSocket.all[0].close();
    send({ type: 'chat.send', spaceId: 's1', text: 'hi' });
    FakeSocket.all[1].open();
    expect(FakeSocket.all[1].sent.map((m) => JSON.parse(m).type)).toEqual([
      'chat.send',
      'subscribe',
    ]);
  });

  it('backs off between failed reconnects and resets after a successful open', async () => {
    const { send } = await load();
    send({ type: 'subscribe', spaceId: 's1' });
    FakeSocket.all[0].close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1].close();
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeSocket.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2].open();
    FakeSocket.all[2].close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it('reconnects at once when the tab becomes visible', async () => {
    const { send } = await load();
    send({ type: 'subscribe', spaceId: 's1' });
    FakeSocket.all[0].close();
    // the spec tsconfig has no DOM lib; jsdom provides `document` at runtime
    (globalThis as unknown as { document: EventTarget }).document.dispatchEvent(
      new Event('visibilitychange'),
    );
    expect(FakeSocket.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(live()).toHaveLength(1);
  });

  it('ignores frames from a socket that is no longer the current one', async () => {
    const { useSpaceEvents } = await load();
    const handler = vi.fn();
    renderHook(() => useSpaceEvents('s1', handler));
    const first = FakeSocket.all[0];
    first.open();
    first.close();
    await vi.advanceTimersByTimeAsync(1000);
    const frame = {
      data: JSON.stringify({ type: 'git.changed', spaceId: 's1' }),
    };
    first.onmessage?.(frame); // a late frame on the closed socket
    expect(handler).not.toHaveBeenCalled();
    FakeSocket.all[1].onmessage?.(frame);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('drops frames that are not a typed JSON object, with one warning each', async () => {
    const { useSpaceEvents } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = vi.fn();
    renderHook(() => useSpaceEvents('s1', handler));
    const sock = FakeSocket.all[0];
    sock.open();
    for (const data of ['not json', '42', '{"spaceId":"s1"}', 'null'])
      sock.onmessage?.({ data });
    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(4);
    sock.onmessage?.({
      data: JSON.stringify({ type: 'git.changed', spaceId: 's1' }),
    });
    expect(handler).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('calls the latest handler without resubscribing', async () => {
    const { useSpaceEvents } = await load();
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = renderHook(({ h }) => useSpaceEvents('s1', h), {
      initialProps: { h: a },
    });
    FakeSocket.all[0].open();
    rerender({ h: b });
    FakeSocket.all[0].onmessage?.({
      data: JSON.stringify({ type: 'git.changed', spaceId: 's1' }),
    });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(
      FakeSocket.all[0].sent.filter((m) => JSON.parse(m).type === 'subscribe'),
    ).toHaveLength(1);
  });
});
