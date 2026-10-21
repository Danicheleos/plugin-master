import { parseSkill } from './skill-blocks.js';

export interface SkillProblem {
  severity: 'error' | 'warning' | 'info';
  field: string;
  message: string;
}

export interface SkillStats {
  bodyLines: number;
  bodyChars: number;
  approxTokens: number;
  descriptionChars: number;
  listingChars: number;
}

// Limits and the portable field set: docs/idea-plan.md "Skills (SKILL.md)".
const PORTABLE = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const CLAUDE_CODE = new Set([
  'when_to_use',
  'disable-model-invocation',
  'user-invocable',
  'disallowed-tools',
  'context',
  'agent',
  'model',
  'paths',
  'hooks',
  'argument-hint',
]);
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_LISTING = 1536;
const MAX_BODY_LINES = 500;
const MAX_BODY_TOKENS = 5000;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Relative file links of a SKILL.md body (markdown links and references/, scripts/, assets/ mentions), outside code fences. */
export function bodyLinks(body: string): string[] {
  let fence = '';
  const prose = body
    .split('\n')
    .filter((line) => {
      const m = /^ {0,3}(```+|~~~+)/.exec(line);
      if (!fence && m) fence = m[1]![0]!;
      else if (fence && m?.[1]![0] === fence) fence = '';
      else return !fence;
      return false;
    })
    .join('\n');
  const found = new Set<string>();
  for (const m of prose.matchAll(/\]\(\s*<?([^)\s>]+)/g)) found.add(m[1]!);
  for (const m of prose.matchAll(/(?<![\w/.(-])(?:references|scripts|assets)\/[\w./-]+/g)) found.add(m[0].replace(/\.+$/, ''));
  return [...found]
    .filter((l) => !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(l))
    .map((l) => l.replace(/[#?].*$/, '').replace(/^(\.\/)+/, ''))
    .filter(Boolean);
}

export function lintSkill(input: { dirName: string; text: string; existingFiles?: Set<string> }): {
  problems: SkillProblem[];
  stats: SkillStats;
} {
  const doc = parseSkill(input.text);
  const fm = doc.frontmatter;
  const problems: SkillProblem[] = [];
  const add = (severity: SkillProblem['severity'], field: string, message: string) =>
    problems.push({ severity, field, message });

  const data = fm && fm.data && typeof fm.data === 'object' && !Array.isArray(fm.data) ? (fm.data as Record<string, unknown>) : {};
  if (!fm) add('error', 'frontmatter', 'Missing YAML frontmatter');
  else if (fm.error) add('error', 'frontmatter', `Invalid YAML: ${fm.error}`);
  else if (fm.data !== null && data !== fm.data) add('error', 'frontmatter', 'Frontmatter must be a YAML mapping');

  const name = str(data.name);
  if (!name) add('error', 'name', 'name is required');
  else {
    if (name.length > MAX_NAME) add('error', 'name', `name is ${name.length} chars, max ${MAX_NAME}`);
    if (!/^[a-z0-9-]+$/.test(name)) add('error', 'name', 'name may only contain lowercase letters, digits and hyphens');
    if (name !== input.dirName) add('error', 'name', `name "${name}" must equal the directory name "${input.dirName}"`);
  }

  const description = str(data.description);
  if (!description) add('error', 'description', 'description is required');
  else if (description.length > MAX_DESCRIPTION)
    add('error', 'description', `description is ${description.length} chars, max ${MAX_DESCRIPTION}`);

  const listingChars = description.length + str(data.when_to_use).length;
  if (listingChars > MAX_LISTING)
    add(
      'warning',
      'description',
      `description + when_to_use is ${listingChars} chars; the skill listing truncates at ${MAX_LISTING} (${listingChars - MAX_LISTING} over)`,
    );

  for (const key of Object.keys(data)) {
    if (PORTABLE.has(key)) continue;
    if (CLAUDE_CODE.has(key)) add('info', key, 'Claude Code only, not portable to claude.ai/Skills API');
    else add('warning', key, `Unknown frontmatter field "${key}"`);
  }
  if ('allowed-tools' in data)
    add('info', 'allowed-tools', 'allowed-tools only pre-approves tools; it does not restrict which tools can be used');

  const body = input.text.slice(fm ? fm.end : input.text.startsWith('﻿') ? 1 : 0);
  const bodyLines = body ? body.replace(/\r?\n$/, '').split('\n').length : 0;
  const approxTokens = Math.ceil(body.length / 4);
  if (bodyLines > MAX_BODY_LINES) add('warning', 'body', `Body is ${bodyLines} lines; recommended max ${MAX_BODY_LINES}`);
  if (approxTokens > MAX_BODY_TOKENS)
    add('warning', 'body', `Body is ~${approxTokens} tokens (estimate: chars/4); recommended max ${MAX_BODY_TOKENS}`);

  if (input.existingFiles)
    for (const l of bodyLinks(body))
      if (!input.existingFiles.has(l)) add('warning', 'body', `Referenced file not found: ${l}`);

  return {
    problems,
    stats: { bodyLines, bodyChars: body.length, approxTokens, descriptionChars: description.length, listingChars },
  };
}
