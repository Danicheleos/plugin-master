import { createContext, useContext, useSyncExternalStore } from 'react';
import { pickEditor, type Item } from '../features/dashboard';

const noDirs: ReadonlySet<string> = new Set();
const noPaths: readonly string[] = [];

type State = {
  /** the dashboard items (a copy of `useDashboard().items`, see `setItems`) */
  items: readonly Item[];
  /** the editor instance that was clicked last (see `pickEditor`) */
  activeEditor: string | null;
  /** expanded dirs per files instance */
  expandedBy: Readonly<Record<string, ReadonlySet<string>>>;
  /** paths watched on behalf of skills/graph instances */
  watchBy: Readonly<Record<string, readonly string[]>>;
};

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Every path the server should watch: open files, expanded dirs, what skills/graph widgets ask for. */
function watchedPaths(s: State): string[] {
  const all = s.items.flatMap((it) =>
    it.type === 'editor' && it.file
      ? [it.file]
      : it.type === 'files'
        ? [...(s.expandedBy[it.i] ?? noDirs)]
        : it.type === 'skills' || it.type === 'graph'
          ? [...(s.watchBy[it.i] ?? noPaths)]
          : [],
  );
  return [...new Set(all)];
}

/**
 * Per-space workspace state that widgets read through selectors (expanded dirs, the active
 * editor's file, watch paths), so a folder toggle re-renders only the files widgets and a
 * selection only the trees/editors, not every widget.
 */
export function createWorkspaceStore(items: readonly Item[]) {
  let state: State = { items, activeEditor: null, expandedBy: {}, watchBy: {} };
  const listeners = new Set<() => void>();
  const set = (next: State) => {
    if (next === state) return;
    state = next;
    listeners.forEach((l) => l());
  };
  let watched: { state: State; paths: readonly string[] } = {
    state,
    paths: watchedPaths(state),
  };

  return {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    setItems: (next: readonly Item[]) =>
      set(next === state.items ? state : { ...state, items: next }),
    setActiveEditor: (i: string | null) =>
      set(state.activeEditor === i ? state : { ...state, activeEditor: i }),
    toggleDir: (instance: string, dir: string) => {
      const next = new Set(state.expandedBy[instance]);
      if (!next.delete(dir)) next.add(dir);
      set({ ...state, expandedBy: { ...state.expandedBy, [instance]: next } });
    },
    /** A removed instance forgets its state. */
    removeInstance: (instance: string) => {
      const { [instance]: _dirs, ...expandedBy } = state.expandedBy;
      const { [instance]: _paths, ...watchBy } = state.watchBy;
      set({ ...state, expandedBy, watchBy });
    },
    /** A duplicate starts with the expanded dirs of its source. */
    copyExpanded: (from: string, to: string) => {
      const src = state.expandedBy[from];
      if (src)
        set({ ...state, expandedBy: { ...state.expandedBy, [to]: src } });
    },
    resetExpanded: () => set({ ...state, expandedBy: {} }),
    setWatch: (instance: string, paths: readonly string[]) => {
      const prev = state.watchBy[instance];
      if (prev && sameList(prev, paths)) return;
      set({ ...state, watchBy: { ...state.watchBy, [instance]: paths } });
    },
    /** Stable: the same array until the set of watched paths changes. */
    getWatchPaths: (): readonly string[] => {
      if (watched.state === state) return watched.paths;
      const next = watchedPaths(state);
      watched = {
        state,
        paths: sameList(watched.paths, next) ? watched.paths : next,
      };
      return watched.paths;
    },
  };
}
export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

/** What widgets may do to the workspace; the object never changes identity. */
export type WorkspaceApi = {
  store: WorkspaceStore;
  /** Opens a file in the active editor (a new editor if there is none). */
  select: (path: string) => void;
  /** Sets the open file of an editor instance. */
  setFile: (instance: string, path: string) => void;
  toggleDir: (instance: string, dir: string) => void;
  setWatch: (instance: string, paths: readonly string[]) => void;
  openNewFile: () => void;
};

const WorkspaceContext = createContext<WorkspaceApi | null>(null);
export const WorkspaceProvider = WorkspaceContext.Provider;

export function useWorkspaceApi(): WorkspaceApi {
  const api = useContext(WorkspaceContext);
  if (!api) throw new Error('useWorkspaceApi: no WorkspaceProvider');
  return api;
}

/** Re-renders only when `select`'s result changes (a primitive or a stable reference). */
function useWorkspaceSelector<T>(select: (s: State) => T): T {
  const { store } = useWorkspaceApi();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

/** Expanded dirs of one files instance. */
export const useExpandedDirs = (instance: string) =>
  useWorkspaceSelector((s) => s.expandedBy[instance] ?? noDirs);

/** The file of the editor that receives opened files (null: none). */
export const useSelectedFile = () =>
  useWorkspaceSelector(
    (s) => pickEditor(s.items, s.activeEditor)?.file ?? null,
  );

/** Paths to watch on the server (stable between changes). */
export function useWatchPaths(store: WorkspaceStore) {
  return useSyncExternalStore(store.subscribe, store.getWatchPaths);
}
