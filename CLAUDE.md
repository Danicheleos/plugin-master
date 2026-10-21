# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Iterations 0 (Nx monorepo), 1 (server: skeleton, security, spaces API), 2 (web shell and spaces UI), 3 (files), 4 (WS hub and file watching) and 5 (Claude chat via the Agent SDK) and 6 (master context) of `docs/mvp-plan.md` are implemented. `.gitignore` contains `docs/*`, so the planning docs are untracked and exist only locally. Read them before designing anything:

- `docs/idea.md`: the product idea.
- `docs/idea-plan.md`: research and the development plan, including stack, architecture and roadmap.
- `docs/eval-plan.md`: next feature, eval results viewer (iterations E0–E3; E0 done: real `aggregate-result.json` shape recorded there).
- `docs/mvp-plan.md`: the MVP plan, split into iterations 0–6. Implement it iteration by iteration and follow its "Rules for implementing agents" section.

All docs, code, comments and UI text are in English.

## Commands

pnpm comes from corepack (`corepack enable pnpm`; version pinned in `packageManager`). pnpm 12 blocks dependency build scripts: new packages with postinstall scripts must be allowed in `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds --all`).

- `pnpm dev`: serves `server` (builds with esbuild, runs `dist/main.js`, prints the open URL with token) and `web` (Vite on 5100) in parallel.
- `pnpm dev:self`: same, but the server is not rebuilt/restarted on changes (`serve` configuration `self`, `watch: false`). Use it when plugin-master is opened as a space in itself: under `pnpm dev`, the agent's own edits of server code restart the server and kill its Claude process (exit 143); the chat error then explains this.
- `pnpm check`: `nx run-many -t lint typecheck test`. Must be green before finishing an iteration.
- One project: `pnpm nx test server`, `pnpm nx typecheck web`, `pnpm nx lint @pm/protocol`.
- One test: `pnpm nx test server -- -t "<test name>"` or `pnpm nx test server -- src/spaces/service.test.ts`.
- If `typecheck` fails with TS6305 after a build, delete the stale `apps/server/dist/*.tsbuildinfo` and `libs/protocol/dist/*.tsbuildinfo`.
- `pnpm dev:lan` / `pnpm dev:self:lan` (`PM_LAN=1`): opt-in LAN access (macOS firewall must allow incoming connections for the `node` binary in use). Only Vite listens on `0.0.0.0`; the API server stays on 127.0.0.1 behind the Vite proxy. `loadConfig` adds this machine's non-internal IPv4 addresses (at startup) to `config.hosts` and `http://<ip>:<webPort>` to `webOrigins`; the token is still required; `main.ts` prints the LAN URLs and a warning. Caveat: the Vite dev server itself serves the app source (and `/@fs/` files under the repo) without a token.
- Env vars: `PM_PORT` (4317), `PM_WEB_PORT` (5100), `PM_LAN`, `PM_TOKEN` (default: persisted, rotated after `PM_TOKEN_TTL_DAYS`), `PM_HOME` (`~/.plugin-master`). Tests must use a temp `PM_HOME`/home dir, never the real one.

## Layout

Details live in nested CLAUDE.md files (loaded by Claude Code when files in that directory are read).

- `apps/server`: Fastify 5 API, WebSocket hub, security guard, spaces, files/watcher, git, Claude chat/session manager, plans, evals, experiments loop, hooks, runs. `buildApp(config)` is what tests use with `app.inject()`; tests are `*.test.ts` next to the code. Details: `apps/server/CLAUDE.md`.
- `apps/web`: React 19 + Vite, react-router v7, react-query, Mantine 9, SCSS Modules; widget dashboard (files, editor, evals, chat, plan, runs, hooks, skills, git, experiments). Details: `apps/web/CLAUDE.md`.
- `libs/protocol`: `@pm/protocol`, zod schemas/types shared by web and server (REST DTOs in `lib/rest.ts`, WS messages in `lib/ws.ts`; new WS message types go there), plus the lossless SKILL.md model. Details: `libs/protocol/CLAUDE.md`.
- Nx 23 package-based workspace (no `project.json`; targets are in each `package.json` and inferred by plugins). `typecheck` runs `tsc --build` with project references, so a new cross-project import needs `pnpm nx sync` (updates tsconfig references) and a `workspace:*` dependency. Server code must list its own npm deps (including `zod`) in `apps/server/package.json`.
- The server build uses `bundle: true` so `@pm/protocol` TS source is inlined; npm packages stay external.
- Token: `security/token.ts` persists it in `$PM_HOME/token.json` (0600) and reuses it across restarts (dev rebuilds), rotating at startup after `PM_TOKEN_TTL_DAYS` (7); `PM_TOKEN` overrides.
- "Use my Claude settings" (`features.userSettings` in `config.json`, Features menu, default off): master sessions then use `settingSources: ['user','project','local']` (your `~/.claude` plugins, skills, MCP, CLAUDE.md); applies when a session is created. Model, permission mode, `canUseTool`, plan MCP server and hooks are always passed explicitly. Experiment stages keep `settingSources: []`. Unverified live: that an explicit `permissionMode` beats the user's `defaultMode`.
- Security caveat: sessions use `settingSources: ['project']` with the chosen permission mode (default `auto`), but an opened third-party plugin's `.claude/settings.json` can still add allow rules or hooks that bypass `canUseTool` prompts; only open plugins you trust.
- Claude auth: nothing is configured by the app; the SDK spawns its bundled Claude Code CLI, which uses the user's existing Claude Code login or `ANTHROPIC_API_KEY` from the server's environment. The SDK is ESM-only and stays external in the CJS server bundle (loaded via `require`, needs Node >= 22.12).

## What plugin-master is

A local (localhost) web UI for interactively building Claude Code plugins and skills:

1. Shape the idea: a detailed description of the end result and the expected behavior.
2. Build the skill structure and a minimal eval.
3. Analyze runs: turns, context, subagent calls, edits, eval results. Drill down from the overall plan to each individual action.
4. Version skills, with GitHub, auto-commit, branches and diffs.
5. Use an optional **master agent** that keeps the idea and current state fresh, launches editor agents, runs evals and analyzes results.

The UI must also read, edit and live-display files, run terminal and git commands, give access to Claude Code (including all its tools), show skills as editable blocks that can be extracted into sub-files, and manage hooks (add, clear, edit).

## Planned architecture (from docs/idea-plan.md)

- **Backend:** Node 22 + TypeScript (Fastify or Hono, `ws`, `node-pty`, `chokidar`, `simple-git`, SQLite). The **Claude Agent SDK (TypeScript)** is the core. Evals go through the official `claude plugin eval`, with `--no-publish`.
- **Frontend:** React + Vite SPA (dockview, Monaco with its diff editor, xterm.js, React Flow, Mermaid). It uses a single multiplexed WebSocket for chat, terminal and fs events.
- **Storage:** files are the source of truth (the plugin itself, `evals/`, and `.plugin-master/` with `IDEA.md`, `STATE.md`, `DECISIONS.md`, `runs/<id>/`). SQLite is only an index of runs, metrics and events.
- **SKILL.md block editor:** build it on remark/mdast with a lossless round-trip. Do not use BlockNote, whose Markdown conversion is lossy.
- **Master agent:** a loop over state files, not one endless session. Each iteration is:
  1. A read-only master proposes one hypothesis.
  2. An executor runs in a separate git worktree or branch `exp/<n>`, with writes restricted to the plugin directory via `canUseTool`.
  3. Run `claude plugin eval`.
  4. An analyst reads the report and the failed traces.
  5. The master updates STATE and DECISIONS, and the user confirms the merge or rollback in the UI.
- **Trace viewer:** rely primarily on SDK events that the app saves itself. The Claude Code JSONL format is undocumented, so use it only to import historical sessions. Record the Claude Code `version` in every run and use versioned adapters.

## Constraints to respect

- **Localhost security from the MVP:**
  - Bind only to `127.0.0.1`/`::1`.
  - Reject any Host header other than localhost, to prevent DNS rebinding.
  - Keep a strict Origin allowlist on the WebSocket upgrade.
  - Require a random session token.
  - Use no wildcard CORS.
  - Never default agents to `bypassPermissions`; route decisions through `canUseTool` with UI confirmation.
- **Licensing:** do not fork opcode or CloudCLI. They are AGPL-3.0, so take ideas only.
- **Code philosophy (from idea.md):**
  - Add or change the minimum needed to cover the problem, keeping modularity and isolation.
  - Refactor continuously toward shorter, better code.
  - Enforce minimality through mechanisms (diff-budget hooks, path isolation, acceptance gates), not just prompt requests.
