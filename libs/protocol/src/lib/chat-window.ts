import type { ChatEvent } from './chat.js';

/** Chat rows kept live (server memory, `chat.history`, the web client); older ones are in the run trace. */
export const MAX_CHAT_ROWS = 300;

const isTool = (e: ChatEvent) =>
  e.kind === 'tool_use' || e.kind === 'tool_result';

/** Subagent tool events (`parentToolUseId`) render under their Agent call: they are never rows. */
const isSubagent = (e: ChatEvent) =>
  isTool(e) && !!(e as { parentToolUseId?: string }).parentToolUseId;

/**
 * Index of the first event of the last `maxRows` chat rows, as the chat renders them: each master
 * message is a row and a run of consecutive master tool events is one row (subagent events in
 * between neither count nor split it). A row is never cut; 0 = everything fits.
 */
export function chatWindowStart(
  events: readonly ChatEvent[],
  maxRows = MAX_CHAT_ROWS,
): number {
  let rows = 0;
  let laterIsTool = false; // the next (later) master event is a tool event
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (isSubagent(e)) continue;
    const tool = isTool(e);
    // walking backwards, a row is met at its last event
    if (!(tool && laterIsTool) && ++rows > maxRows) return i + 1;
    laterIsTool = tool;
  }
  return 0;
}
