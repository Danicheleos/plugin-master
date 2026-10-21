import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { z } from 'zod';

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

const storeKey = (scope: string) => `pm.evals.${scope}`;
const entries = new Map<string, { raw: string | null; prefs: EvalPrefs }>();
const listeners = new Set<() => void>();

function parse(raw: string | null): EvalPrefs {
  let json: unknown;
  try {
    json = raw === null ? {} : JSON.parse(raw);
  } catch {
    json = {};
  }
  const r = PrefsSchema.safeParse(json);
  return r.success ? r.data : PrefsSchema.parse({});
}

/** Stable snapshot: the same object until the stored value or a write changes it. */
function read(scope: string): EvalPrefs {
  const known = entries.get(scope);
  let raw: string | null;
  try {
    raw = localStorage.getItem(storeKey(scope));
  } catch {
    raw = known?.raw ?? null; // storage unavailable: memory only
  }
  if (known && known.raw === raw) return known.prefs;
  const prefs = parse(raw);
  entries.set(scope, { raw, prefs });
  return prefs;
}

export function updatePrefs(
  scope: string,
  fn: (p: EvalPrefs) => Partial<EvalPrefs>,
) {
  const prefs = { ...read(scope), ...fn(read(scope)) };
  const raw = JSON.stringify(prefs);
  entries.set(scope, { raw, prefs });
  try {
    localStorage.setItem(storeKey(scope), raw);
  } catch {
    /* quota or blocked storage: the settings live until reload */
  }
  listeners.forEach((l) => l());
}

/** A duplicated widget starts with the settings of its source. */
export function copyPrefs(spaceId: string, from: string, to: string) {
  const src = read(`${spaceId}.${from}`);
  updatePrefs(`${spaceId}.${to}`, () => src);
}

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener('storage', l); // other browser tabs
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', l);
  };
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
  const prefs = useSyncExternalStore(subscribe, () => read(scope));
  return [
    prefs,
    (fn: (p: EvalPrefs) => Partial<EvalPrefs>) => updatePrefs(scope, fn),
  ] as const;
}

/** Expanded state by key; `def` until the user toggles it. */
export function useOpens() {
  const [prefs, update] = useEvalPrefs();
  return {
    isOpen: (key: string, def = false) => prefs.open[key] ?? def,
    toggle: (key: string, def = false) =>
      update((p) => ({ open: { ...p.open, [key]: !(p.open[key] ?? def) } })),
  };
}

export function useOpen(key: string, def = false) {
  const { isOpen, toggle } = useOpens();
  return [isOpen(key, def), () => toggle(key, def)] as const;
}
