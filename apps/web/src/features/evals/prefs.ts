import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { z } from 'zod';
import { createPersistentStore } from '../../shared/storage';

/**
 * Persisted UI settings of one evals widget instance (never server data), in localStorage
 * `pm.evals.<spaceId>.<widgetId>`. One module-level store per scope, so every component of the
 * instance stays in sync and the settings survive unmounts (e.g. back from a run page). Each
 * field falls back to its default when the stored data is missing or corrupt.
 */
const FormSchema = z.object({
  cases: z.array(z.string()).catch([]),
  tags: z.array(z.string()).catch([]),
  runs: z.string().catch(''),
  cost: z.string().catch('1'),
  model: z.string().catch(''),
  ablation: z.boolean().catch(false),
  allowTools: z.array(z.string()).catch([]),
});
const PrefsSchema = z.object({
  view: z.enum(['suites', 'targets', 'invocations']).catch('suites'),
  /** The open run page; null = the list. */
  page: z
    .object({
      id: z.string(),
      group: z.boolean(),
      focusCase: z.string().optional(),
      compareWith: z.string().optional(),
    })
    .nullable()
    .catch(null),
  /** "Last runs shown" of the skills & agents view. */
  limit: z.number().int().positive().optional().catch(undefined),
  /** Run page: one row per repetition of a case instead of one aggregated row. */
  split: z.boolean().catch(false),
  /** Visible column ids per table kind; absent = the data-driven default. */
  columns: z.record(z.string(), z.array(z.string())).catch({}),
  /** Visible chart ids; absent = every metric with at least two values. */
  charts: z.array(z.string()).optional().catch(undefined),
  /** Expanded state by key (`suite:<key>`, `run:<id>:case:<name>`, ...); absent = the caller's default. */
  open: z.record(z.string(), z.boolean()).catch({}),
  /** Run form values (no consent checkboxes). */
  form: FormSchema.catch(() => FormSchema.parse({})),
});
export type EvalPrefs = z.infer<typeof PrefsSchema>;

/** Invocations column ids before they came from the shared metric columns. */
const RENAMED: Record<string, string> = { cost: 'costUsd', time: 'durationMs' };

function parse(raw: string | null): EvalPrefs {
  let json: unknown;
  try {
    json = raw === null ? {} : JSON.parse(raw);
  } catch {
    json = {};
  }
  const r = PrefsSchema.safeParse(json);
  const prefs = r.success ? r.data : PrefsSchema.parse({});
  const inv = prefs.columns.invocations;
  if (inv) prefs.columns.invocations = inv.map((id) => RENAMED[id] ?? id);
  return prefs;
}

const store = createPersistentStore<EvalPrefs>({
  key: (scope) => `pm.evals.${scope}`,
  parse,
  crossTab: true, // other browser tabs
});

/** Stable snapshot: the same object until the stored value or a write changes it. */
const read = (scope: string) => store.read(scope);

export function updatePrefs(
  scope: string,
  fn: (p: EvalPrefs) => Partial<EvalPrefs>,
) {
  const prefs = { ...read(scope), ...fn(read(scope)) };
  store.write(scope, prefs);
}

/** A duplicated widget starts with the settings of its source. */
export function copyPrefs(spaceId: string, from: string, to: string) {
  const src = read(`${spaceId}.${from}`);
  updatePrefs(`${spaceId}.${to}`, () => src);
}

const ScopeContext = createContext('default');
/** Scopes the settings of everything below to one evals widget instance. */
export const EvalPrefsScope = ({
  spaceId,
  widgetId = 'default',
  children,
}: {
  spaceId: string;
  widgetId?: string;
  children: ReactNode;
}) =>
  createElement(
    ScopeContext.Provider,
    { value: `${spaceId}.${widgetId}` },
    children,
  );

export function useEvalPrefs() {
  const scope = useContext(ScopeContext);
  const prefs = useSyncExternalStore(store.subscribe, () => read(scope));
  return [
    prefs,
    (fn: (p: EvalPrefs) => Partial<EvalPrefs>) => updatePrefs(scope, fn),
  ] as const;
}

/**
 * One derived value of the settings. Re-renders only when `select`'s result changes, so it must
 * return a primitive (or an otherwise stable reference): a fresh object each call would loop.
 */
export function useEvalPref<T>(select: (p: EvalPrefs) => T): T {
  const scope = useContext(ScopeContext);
  return useSyncExternalStore(store.subscribe, () => select(read(scope)));
}

/** Writer of the scope's settings (stable identity per scope, never re-renders the caller). */
export function useUpdatePrefs() {
  const scope = useContext(ScopeContext);
  return useCallback(
    (fn: (p: EvalPrefs) => Partial<EvalPrefs>) => updatePrefs(scope, fn),
    [scope],
  );
}

/** Expanded state of many keys at once (re-renders on any toggle); a row of one key uses `useOpen`. */
export function useOpens() {
  const [prefs, update] = useEvalPrefs();
  return {
    isOpen: (key: string, def = false) => prefs.open[key] ?? def,
    toggle: (key: string, def = false) =>
      update((p) => ({ open: { ...p.open, [key]: !(p.open[key] ?? def) } })),
  };
}

/** Expanded state of one key; `def` until the user toggles it. Re-renders only when this key changes. */
export function useOpen(key: string, def = false) {
  const open = useEvalPref((p) => p.open[key] ?? def);
  const update = useUpdatePrefs();
  const toggle = useCallback(
    () =>
      update((p) => ({ open: { ...p.open, [key]: !(p.open[key] ?? def) } })),
    [update, key, def],
  );
  return [open, toggle] as const;
}
