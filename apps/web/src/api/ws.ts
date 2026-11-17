import { useEffect } from 'react';
import type { ClientMessage, ServerMessage } from '@pm/protocol';
import { useLatestCallback } from '../shared/ui/useLatestCallback';
import { getToken } from './auth';

type Listener = (msg: ServerMessage) => void;

const listeners = new Set<Listener>();
const subscribed = new Set<string>(); // re-sent after every reconnect
const watching = new Map<string, string>(); // fs.watch per space, replayed after subscribe
const queued: string[] = []; // non-subscribe messages sent while offline
let socket: WebSocket | undefined; // the only live socket (connecting or open)
let retry: ReturnType<typeof setTimeout> | undefined;
let attempt = 0; // failed reconnects in a row: the delay doubles up to MAX_DELAY_MS

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/**
 * Parses one frame. The protocol has no runtime schema for server messages (they are plain types
 * produced by our own server), so only the envelope is checked: a JSON object with a string `type`.
 * Anything else is dropped with one warning. Cheap on purpose: this runs for every chat event.
 */
export function parseFrame(raw: unknown): ServerMessage | undefined {
  try {
    const v: unknown = JSON.parse(String(raw));
    if (
      v &&
      typeof v === 'object' &&
      typeof (v as { type?: unknown }).type === 'string'
    )
      return v as ServerMessage;
  } catch {
    // reported below
  }
  console.warn('[ws] dropped an invalid frame');
  return undefined;
}

function connect(): void {
  if (socket) return; // never a second socket: it would deliver (and replay) everything twice
  clearTimeout(retry);
  retry = undefined;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(
    `${proto}://${window.location.host}/ws?token=${encodeURIComponent(getToken() ?? '')}`,
  );
  socket = ws;
  ws.onopen = () => {
    attempt = 0;
    // queued first: a reply to an already-settled prompt must not follow a re-subscribe
    for (const m of queued.splice(0)) ws.send(m);
    for (const spaceId of subscribed)
      ws.send(JSON.stringify({ type: 'subscribe', spaceId }));
    for (const m of watching.values()) ws.send(m);
  };
  ws.onmessage = (e) => {
    if (socket !== ws) return;
    const msg = parseFrame(e.data);
    if (msg) listeners.forEach((l) => l(msg));
  };
  // only this socket's own close may clear `socket` and schedule a reconnect
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = undefined;
    reconnectLater();
  };
}

function reconnectLater(): void {
  if (retry) return;
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt++);
  retry = setTimeout(connect, delay);
}

/** Reconnects at once (no backoff) when the tab comes back or the network returns, if anything needs the socket. */
function wake(): void {
  if (document.visibilityState === 'hidden' || socket) return;
  if (!subscribed.size && !queued.length) return;
  attempt = 0;
  connect();
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
}

/** Sends a message; `subscribe` and `fs.watch` are remembered (until `unsubscribe`) and replayed on reconnect. Other messages are queued while offline and flushed on connect. */
export function send(msg: ClientMessage): void {
  if (!socket) connect();
  if (msg.type === 'subscribe') subscribed.add(msg.spaceId);
  if (msg.type === 'unsubscribe') {
    subscribed.delete(msg.spaceId);
    watching.delete(msg.spaceId);
  }
  const data = JSON.stringify(msg);
  // remembered messages are replayed on connect, so they are never queued
  if (msg.type === 'fs.watch') watching.set(msg.spaceId, data);
  const replayed =
    msg.type === 'subscribe' ||
    msg.type === 'unsubscribe' ||
    msg.type === 'fs.watch';
  if (socket?.readyState === WebSocket.OPEN) socket.send(data);
  else if (!replayed) queued.push(data);
}

const refs = new Map<string, number>(); // listeners per space

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribes to the space (reference-counted: one subscribe/unsubscribe per space) and calls `handler` for each of its server messages. */
export function useSpaceEvents(
  spaceId: string,
  handler: (msg: ServerMessage) => void,
): void {
  const onMessage = useLatestCallback(handler);
  useEffect(() => {
    const n = refs.get(spaceId) ?? 0;
    refs.set(spaceId, n + 1);
    if (n === 0) send({ type: 'subscribe', spaceId });
    const unlisten = subscribe((msg) => {
      if ('spaceId' in msg && msg.spaceId === spaceId) onMessage(msg);
    });
    return () => {
      unlisten();
      const left = (refs.get(spaceId) ?? 1) - 1;
      refs.set(spaceId, left);
      if (left === 0) send({ type: 'unsubscribe', spaceId });
    };
  }, [spaceId, onMessage]);
}
