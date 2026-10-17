import { useEffect, useRef } from 'react';
import type { ClientMessage, ServerMessage } from '@pm/protocol';
import { getToken } from './auth';

type Listener = (msg: ServerMessage) => void;

const listeners = new Set<Listener>();
const subscribed = new Set<string>(); // re-sent after every reconnect
const queued: string[] = []; // non-subscribe messages sent while offline
let socket: WebSocket | undefined;

function connect(): void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(
    `${proto}://${window.location.host}/ws?token=${encodeURIComponent(getToken() ?? '')}`,
  );
  socket = ws;
  ws.onopen = () => {
    // queued first: a reply to an already-settled prompt must not follow a re-subscribe
    for (const m of queued.splice(0)) ws.send(m);
    for (const spaceId of subscribed)
      ws.send(JSON.stringify({ type: 'subscribe', spaceId }));
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMessage;
    listeners.forEach((l) => l(msg));
  };
  ws.onclose = () => {
    socket = undefined;
    setTimeout(connect, 1000);
  };
}

/** Sends a message; `subscribe` is remembered (until `unsubscribe`) and replayed on reconnect. Other messages are queued while offline and flushed on connect. */
export function send(msg: ClientMessage): void {
  if (!socket) connect();
  if (msg.type === 'subscribe') subscribed.add(msg.spaceId);
  if (msg.type === 'unsubscribe') subscribed.delete(msg.spaceId);
  const data = JSON.stringify(msg);
  if (socket?.readyState === WebSocket.OPEN) socket.send(data);
  else if (msg.type !== 'subscribe' && msg.type !== 'unsubscribe')
    queued.push(data);
}

const refs = new Map<string, number>(); // listeners per space

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribes to the space (reference-counted: one subscribe/unsubscribe per space) and calls `handler` for each of its server messages. */
export function useSpaceEvents(
  spaceId: string,
  handler: (msg: ServerMessage) => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const n = refs.get(spaceId) ?? 0;
    refs.set(spaceId, n + 1);
    if (n === 0) send({ type: 'subscribe', spaceId });
    const unlisten = subscribe((msg) => {
      if ('spaceId' in msg && msg.spaceId === spaceId) ref.current(msg);
    });
    return () => {
      unlisten();
      const left = (refs.get(spaceId) ?? 1) - 1;
      refs.set(spaceId, left);
      if (left === 0) send({ type: 'unsubscribe', spaceId });
    };
  }, [spaceId]);
}
