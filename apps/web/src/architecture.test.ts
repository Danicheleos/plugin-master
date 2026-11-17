/**
 * Layer rules of apps/web/src (dependency-free: reads the sources with node:fs).
 *
 *  - `shared/` is feature-agnostic: it imports nothing from `features/`, `pages/` or `app/`.
 *  - A feature is used only through its public `index.ts`: nobody outside `features/<x>/` imports
 *    a deeper path of it.
 *  - Features do not import `pages/` or `app/`, and `api/` imports no feature.
 *  - There are no import cycles between features.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = __dirname;
const EXTS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !name.endsWith('.d.ts') &&
      name !== 'test-setup.ts'
      ? [p]
      : [];
  });
}

const rel = (p: string) => relative(SRC, p).split(sep).join('/');

/** Relative import specifiers of a source (static, dynamic and side-effect imports, re-exports). */
export function importsOf(source: string): string[] {
  const out: string[] = [];
  const re =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}(?:\/[^'"\n]*)?)\1/g;
  for (let m = re.exec(source); m; m = re.exec(source)) out.push(m[2]);
  return out;
}

function resolveImport(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec);
  for (const e of EXTS) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined; // scss, json, ... are not part of the layering
}

const layerOf = (file: string) => {
  const parts = rel(file).split('/');
  if (parts[0] === 'features' && parts.length > 2)
    return { layer: 'feature' as const, name: parts[1] };
  return { layer: parts[0], name: '' };
};
const isIndex = (file: string) => /\/index\.tsx?$/.test(rel(file));

type Edge = { from: string; to: string };

function collect() {
  const edges: Edge[] = [];
  for (const file of walk(SRC)) {
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      const to = resolveImport(file, spec);
      if (to) edges.push({ from: rel(file), to: rel(to) });
    }
  }
  return edges;
}

/** The first cycle in a graph given as adjacency lists, as a path `a -> b -> a`, if any. */
export function findCycle(
  graph: Map<string, Set<string>>,
): string[] | undefined {
  const state = new Map<string, 1 | 2>(); // 1 = on the stack, 2 = done
  const stack: string[] = [];
  const visit = (n: string): string[] | undefined => {
    state.set(n, 1);
    stack.push(n);
    for (const m of graph.get(n) ?? []) {
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m];
      if (!state.has(m)) {
        const c = visit(m);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(n, 2);
    return undefined;
  };
  for (const n of graph.keys()) {
    if (!state.has(n)) {
      const c = visit(n);
      if (c) return c;
    }
  }
  return undefined;
}

describe('architecture', () => {
  const edges = collect();
  const abs = (p: string) => join(SRC, p);

  it('scans the sources', () => {
    expect(edges.length).toBeGreaterThan(100);
  });

  it('shared/ imports nothing from features/, pages/ or app/', () => {
    const bad = edges.filter(
      (e) =>
        layerOf(abs(e.from)).layer === 'shared' &&
        ['features', 'pages', 'app'].includes(layerOf(abs(e.to)).layer),
    );
    expect(bad.map((e) => `${e.from} -> ${e.to}`)).toEqual([]);
  });

  it('api/ and features/ do not import pages/ or app/, api/ imports no feature', () => {
    const bad = edges.filter((e) => {
      const f = layerOf(abs(e.from));
      const t = layerOf(abs(e.to));
      return (
        ((f.layer === 'feature' || f.layer === 'api') &&
          (t.layer === 'pages' || t.layer === 'app')) ||
        (f.layer === 'api' && t.layer === 'feature')
      );
    });
    expect(bad.map((e) => `${e.from} -> ${e.to}`)).toEqual([]);
  });

  it('features are imported only through their index.ts', () => {
    const bad = edges.filter((e) => {
      const f = layerOf(abs(e.from));
      const t = layerOf(abs(e.to));
      if (t.layer !== 'feature') return false;
      if (f.layer === 'feature' && f.name === t.name) return false;
      return !isIndex(abs(e.to));
    });
    expect(
      bad.map((e) => `${e.from} -> ${e.to} (use features/<name>)`),
    ).toEqual([]);
  });

  it('has no import cycles between features', () => {
    const graph = new Map<string, Set<string>>();
    for (const e of edges) {
      const f = layerOf(abs(e.from));
      const t = layerOf(abs(e.to));
      if (f.layer !== 'feature') continue;
      if (!graph.has(f.name)) graph.set(f.name, new Set());
      if (t.layer === 'feature' && t.name !== f.name)
        graph.get(f.name)?.add(t.name);
    }
    const cycle = findCycle(graph);
    expect(cycle ? cycle.join(' -> ') : undefined).toBeUndefined();
  });

  it('finds cycles (checker self-test)', () => {
    const g = new Map([
      ['a', new Set(['b'])],
      ['b', new Set(['c'])],
      ['c', new Set(['a'])],
    ]);
    expect(findCycle(g)).toEqual(['a', 'b', 'c', 'a']);
    expect(findCycle(new Map([['a', new Set(['b'])]]))).toBeUndefined();
  });

  it('finds imports', () => {
    expect(
      importsOf(
        "import a from './a';\nexport { b } from '../b';\nconst c = import('./c');\nimport './d';\nimport x from 'react';",
      ),
    ).toEqual(['./a', '../b', './c', './d']);
  });
});
