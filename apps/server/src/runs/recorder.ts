import { execFile } from 'node:child_process';
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { RunMetaSchema, type RunMeta } from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { cut } from '../lib/text';
import { withLock } from '../spaces/config-file';

export const RUN_ID = /^[A-Za-z0-9_-]{1,100}$/;
export const runDir = (root: string, id: string) =>
  resolveInSpace(root, `.plugin-master/runs/${id}`);

type Raw = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

/** HEAD sha when `root` is inside a git repo, else undefined. */
export const gitHead = (root: string) =>
  new Promise<string | undefined>((resolve) =>
    execFile(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: root, timeout: 2000 },
      (err, out) => resolve(err ? undefined : out.trim() || undefined),
    ),
  );

export type RunWriter = {
  /** The prompt sent to the session (the SDK does not echo it). */
  user(text: string): void;
  /** One raw SDK message. */
  message(m: unknown): void;
};

/**
 * Appends raw SDK messages to `<root>/.plugin-master/runs/<sessionId>/messages.jsonl` and keeps
 * `meta.json`. The session id comes with the first SDK message; earlier lines are buffered.
 * The run id is the id of the session that produced the messages (a resume that keeps the id
 * appends to the same run; a new id starts a run with `resumedFrom`). Failures go to `onError`.
 */
export function createRecorder(
  onError: (e: unknown) => void = console.error,
  head: (root: string) => Promise<string | undefined> = gitHead,
) {
  return {
    start(root: string, resumeFrom?: string): RunWriter {
      let id: string | undefined;
      let pending: Raw[] = [];
      let title = '';
      let chain: Promise<unknown> = Promise.resolve();
      let dir = '';
      let meta: RunMeta | undefined;
      let costBase = 0;
      let cost = 0;
      const enqueue = (fn: () => Promise<void>) => {
        chain = chain.then(fn).catch(onError);
      };

      /** Folds messages into meta and appends them; meta is saved on init/result/first write. */
      const append = (ms: Raw[], force = false) =>
        withLock(dir, async () => {
          if (!meta) return;
          let save = force;
          for (const m of ms) {
            meta.endedAt = new Date().toISOString();
            if (m.type === 'system' && m.subtype === 'init') {
              if (typeof m.model === 'string' && !meta.models.includes(m.model))
                meta.models.push(m.model);
              if (typeof m.claude_code_version === 'string')
                meta.claudeVersion = m.claude_code_version;
              save = true;
            } else if (m.type === 'result') {
              meta.turns += num(m.num_turns);
              cost = num(m.total_cost_usd);
              save = true;
            }
          }
          await mkdir(dir, { recursive: true });
          await appendFile(
            `${dir}/messages.jsonl`,
            ms.map((m) => JSON.stringify(m)).join('\n') + '\n',
          );
          if (save) {
            meta.costUsd = costBase + cost;
            // rename: a reader never sees a half-written meta.json
            await writeFile(
              `${dir}/meta.json.tmp`,
              JSON.stringify(meta, null, 2) + '\n',
            );
            await rename(`${dir}/meta.json.tmp`, `${dir}/meta.json`);
          }
        });

      async function init(sid: string, first: Raw[]) {
        dir = runDir(root, sid);
        const old = await readFile(`${dir}/meta.json`, 'utf8').then(
          (t) => RunMetaSchema.parse(JSON.parse(t)),
          () => undefined,
        );
        const now = new Date().toISOString();
        meta = old ?? {
          id: sid,
          title,
          startedAt: now,
          endedAt: now,
          turns: 0,
          costUsd: 0,
          models: [],
          commit: await head(root),
        };
        costBase = meta.costUsd;
        if (resumeFrom && resumeFrom !== sid) meta.resumedFrom = resumeFrom;
        await append(first, true);
      }

      const push = (m: Raw) => {
        if (id) return enqueue(() => append([m]));
        const sid = m.session_id;
        if (typeof sid !== 'string' || !RUN_ID.test(sid))
          return void pending.push(m);
        id = sid;
        const first = [...pending, m];
        pending = [];
        enqueue(() => init(sid, first));
      };

      return {
        user(text) {
          title ||= cut(text.replace(/\s+/g, ' ').trim(), 80);
          push({
            type: 'user',
            message: { role: 'user', content: text },
            parent_tool_use_id: null,
          });
        },
        message: (m) => push(m as Raw),
      };
    },
  };
}

export type Recorder = ReturnType<typeof createRecorder>;
