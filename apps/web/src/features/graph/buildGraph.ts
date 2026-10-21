import { bodyLinks, parseSkill } from '@pm/protocol';

export type NodeKind = 'manifest' | 'skill' | 'agent' | 'command' | 'hook' | 'script' | 'mcp' | 'case';
export type GraphNode = { id: string; kind: NodeKind; label: string; file?: string };
export type GraphEdge = { id: string; source: string; target: string };

export type GraphInput = {
  /** Space-relative paths of the files that exist (listing of the plugin directories). */
  files: readonly string[];
  /** Text of every `skills/<n>/SKILL.md` and `agents/*.md`, by path. */
  texts: Readonly<Record<string, string>>;
  hooks: readonly { file: string; event: string; group: number; matcher?: string; handlers: readonly Record<string, unknown>[] }[];
  mcpServers: readonly string[];
  cases: readonly { name: string; dir: string }[];
};

const MANIFESTS = ['.claude-plugin/plugin.json', 'plugin.json'];

/** Resolves `link` against `base` (a directory) or the space root; null if it leaves the space. */
function resolve(base: string, link: string): string[] {
  const norm = (p: string) => {
    const out: string[] = [];
    for (const s of p.split('/')) {
      if (s === '..') {
        if (!out.pop()) return null;
      } else if (s && s !== '.') out.push(s);
    }
    return out.join('/');
  };
  return [norm(`${base}/${link}`), norm(link)].filter((p): p is string => !!p);
}

/** Space paths a hook command runs via `${CLAUDE_PLUGIN_ROOT}/...`. */
export function commandScripts(command: string): string[] {
  const found = [...command.matchAll(/\$\{?CLAUDE_PLUGIN_ROOT\}?\/([^\s"'`;|&)]+)/g)].map((m) => m[1]!);
  return found.flatMap((f) => resolve('', f));
}

function skillNames(fm: unknown): string[] {
  const v = fm && typeof fm === 'object' ? (fm as Record<string, unknown>).skills : undefined;
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return list.flatMap((s) => (typeof s === 'string' && s.trim() ? [s.trim()] : []));
}

/** Plugin structure as nodes and edges; links that do not resolve to a known file or node are dropped. */
export function buildGraph(input: GraphInput): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const files = new Set(input.files);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const node = (n: GraphNode) => void (nodes.has(n.id) || nodes.set(n.id, n));
  const edge = (source: string, target: string) => {
    if (source !== target && nodes.has(source) && nodes.has(target)) edges.set(`${source}>${target}`, { id: `${source}>${target}`, source, target });
  };
  const fileNode = (path: string): string | null => {
    if (!files.has(path)) return null;
    const id = `file:${path}`;
    if (!nodes.has(id) && !nodes.has(path)) node({ id, kind: 'script', label: path, file: path });
    return nodes.has(path) ? path : id;
  };

  const manifest = MANIFESTS.find((m) => files.has(m));
  if (manifest) node({ id: manifest, kind: 'manifest', label: 'plugin.json', file: manifest });

  const skillByName = new Map<string, string>();
  const frontmatter = new Map<string, unknown>();
  for (const f of [...files].sort()) {
    const sk = /^skills\/([^/]+)\/SKILL\.md$/.exec(f);
    const ag = /^agents\/([^/]+)\.md$/.exec(f);
    const cm = /^commands\/(.+)$/.exec(f);
    if (sk) {
      node({ id: f, kind: 'skill', label: sk[1]!, file: f });
      skillByName.set(sk[1]!, f);
    } else if (ag) node({ id: f, kind: 'agent', label: ag[1]!, file: f });
    else if (cm) node({ id: f, kind: 'command', label: cm[1]!, file: f });
    const text = input.texts[f];
    if (text !== undefined && (sk || ag)) frontmatter.set(f, parseSkill(text).frontmatter?.data);
  }
  for (const s of input.mcpServers) node({ id: `mcp:${s}`, kind: 'mcp', label: s, file: files.has('.mcp.json') ? '.mcp.json' : undefined });
  for (const c of input.cases) node({ id: `case:${c.dir}`, kind: 'case', label: c.name });

  // hooks, and the scripts they run
  for (const h of input.hooks) {
    const id = `hook:${h.file}:${h.event}:${h.group}`;
    node({ id, kind: 'hook', label: h.matcher ? `${h.event} (${h.matcher})` : h.event, file: files.has(h.file) ? h.file : undefined });
    if (nodes.get(h.file)?.kind === 'skill' || nodes.get(h.file)?.kind === 'agent') edge(h.file, id);
    for (const hd of h.handlers)
      if (typeof hd.command === 'string')
        for (const p of commandScripts(hd.command)) {
          const t = fileNode(p);
          if (t) edge(id, t);
        }
  }

  // skill -> linked files and skills; agent -> skills
  for (const [path, text] of Object.entries(input.texts)) {
    const n = nodes.get(path);
    if (!n) continue;
    if (n.kind === 'skill') {
      const body = text.slice(parseSkill(text).frontmatter?.end ?? 0);
      for (const l of bodyLinks(body)) {
        const p = resolve(path.replace(/[^/]*$/, ''), l).find((c) => files.has(c));
        const t = p && fileNode(p);
        if (t) edge(path, t);
      }
    } else if (n.kind === 'agent')
      for (const s of skillNames(frontmatter.get(path))) {
        const t = skillByName.get(s);
        if (t) edge(path, t);
      }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

const COLUMNS: NodeKind[] = ['manifest', 'skill', 'agent', 'command', 'hook', 'script', 'mcp', 'case'];
export const COL_W = 260;
export const ROW_H = 56;

/** Layered columns by node type (empty types take no column), rows sorted by label. */
export function layoutGraph(nodes: readonly GraphNode[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const kinds = COLUMNS.map((k) => nodes.filter((n) => n.kind === k)).filter((l) => l.length);
  kinds.forEach((list, col) =>
    [...list]
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((n, row) => out.set(n.id, { x: col * COL_W, y: row * ROW_H })),
  );
  return out;
}
