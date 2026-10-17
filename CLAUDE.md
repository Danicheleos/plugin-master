# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Iterations 0 (Nx monorepo), 1 (server: skeleton, security, spaces API), 2 (web shell and spaces UI), 3 (files), 4 (WS hub and file watching) and 5 (Claude chat via the Agent SDK) and 6 (master context) of `docs/mvp-plan.md` are implemented. `.gitignore` contains `docs/*`, so the planning docs are untracked and exist only locally. Read them before designing anything:

- `docs/idea.md`: the product idea.
- `docs/idea-plan.md`: research and the development plan, including stack, architecture and roadmap.
- `docs/mvp-plan.md`: the current MVP plan, split into iterations 0–6. Implement it iteration by iteration and follow its "Rules for implementing agents" section.

All docs, code, comments and UI text are in English.

## Commands

pnpm comes from corepack (`corepack enable pnpm`; version pinned in `packageManager`). pnpm 12 blocks dependency build scripts: new packages with postinstall scripts must be allowed in `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds --all`).

- `pnpm dev`: serves `server` (builds with esbuild, runs `dist/main.js`, prints the open URL with token) and `web` (Vite on 4200) in parallel.
- `pnpm check`: `nx run-many -t lint typecheck test`. Must be green before finishing an iteration.
- One project: `pnpm nx test server`, `pnpm nx typecheck web`, `pnpm nx lint @pm/protocol`.
- One test: `pnpm nx test server -- -t "<test name>"` or `pnpm nx test server -- src/spaces/service.test.ts`.
- If `typecheck` fails with TS6305 after a build, delete the stale `apps/server/dist/*.tsbuildinfo` and `libs/protocol/dist/*.tsbuildinfo`.
- Env vars: `PM_PORT` (4317), `PM_WEB_PORT` (4200), `PM_TOKEN` (random per start), `PM_HOME` (`~/.plugin-master`). Tests must use a temp `PM_HOME`/home dir, never the real one.

## Layout

- `apps/server`: Fastify 5. `src/{main,app,config}.ts`, `lib/errors.ts` (`AppError`), `security/guard.ts` (Host/Origin/token hook + `verifyWsRequest`), `spaces/{registry,scaffold,templates,service,routes}.ts`, `files/{safe-path,service,watcher,routes}.ts` (all user paths go through `resolveInSpace`, which checks the lexical path and the realpath of the deepest existing ancestor, so symlinks cannot escape the space and NUL bytes are rejected; the service functions take a space root, routes look it up in the registry), `claude/{session,session-manager,permissions,map-events}.ts` (see Chat below), `lib/async-queue.ts`, `ws/hub.ts` (`createHub(config)`: `plugin`, `broadcast`, `on(type, handler)`, `onSubscribe`, `onIdle`). `buildApp(config)` is what tests use with `app.inject()`. Tests are `*.test.ts` next to the code.
- `apps/web`: React 19 + Vite, `react-router` (v7+ single package, not `react-router-dom`), react-query, Mantine 9 (`@mantine/core`/`hooks`; `postcss.config.cjs` with `postcss-preset-mantine`) and SCSS Modules (`*.module.scss`, `sass-embedded`; no `.css` files besides Mantine's own import in `main.tsx`). `src/app/app.tsx` (token gate, providers, routes), `api/{auth,http}.ts` (token capture from `?token=` into localStorage; `request()` adds Bearer, throws `ApiError`, clears token on 401), `api/ws.ts` (singleton WS client with 1 s reconnect, replays `subscribe`; `useSpaceEvents`), `features/spaces/` (hooks, `SpacesPage`, Create/Open dialogs), `features/files/` (tree, Monaco `FileEditor`, `NewFileDialog`), `features/chat/` (`useChat`, `ChatPanel`, `MessageList` with react-markdown, `PermissionPrompt`), `pages/WorkspacePage.tsx` (3-column grid; handles `fs.changed`). `vite.config.mts` proxies `/api` and `/ws` to `127.0.0.1:$PM_PORT` without `changeOrigin` (the server's Host guard needs `localhost`); the dev port comes from `PM_WEB_PORT`. Web deps (including `zod`) are listed in `apps/web/package.json`.
- `libs/protocol`: `@pm/protocol`, zod schemas and types shared by web and server. REST DTOs are in `lib/rest.ts`, WS messages in `lib/ws.ts` (`ClientMessageSchema` is validated by the hub; `ServerMessage` is a plain type). New WS message types go there (source-only package, consumed via the pnpm workspace symlink and bundled by esbuild).
- Nx 23 package-based workspace (no `project.json`; targets are in each `package.json` and inferred by plugins). `typecheck` runs `tsc --build` with project references, so a new cross-project import needs `pnpm nx sync` (updates tsconfig references) and a `workspace:*` dependency. Server code must list its own npm deps (including `zod`) in `apps/server/package.json`.
- WebSocket: `@fastify/websocket` must be registered on the root app **before** `registerGuard` (see `app.ts`); otherwise an upgrade rejected by the guard leaves its socket open and `app.close()` hangs. `/ws` is gated by a route-level `onRequest` hook calling `verifyWsRequest` (Fastify matches the decoded route, so `/%77s` cannot bypass it). Watchers (chokidar v4, no globs: `ignored` is a function) start on a space's first `subscribe` (stored as promises) and close via `hub.onIdle` (last `unsubscribe` or socket close). `main.ts` strips the query string from logged request URLs because `/ws` carries the token there.
- Chat (iteration 5): `session-manager.ts` keeps per-space `{session, status, events}` in memory only and registers the hub handlers (`chat.send/interrupt/reset`, `permission.reply`, `onSubscribe` sends `chat.history` plus still-pending `permission.request`s). `session.ts` wraps the SDK `query()` in streaming-input mode (`AsyncQueue<SDKUserMessage>`, preset `claude_code` system prompt with `append`, `settingSources: ['project']`, no model set); the manager takes a `SessionFactory` so tests use a fake. Context (iteration 6): `context/build-context.ts` `buildContext(root, files)` reads each file via `resolveInSpace` (missing = skipped, order kept; outside-space path, directory or NUL-containing file throws, so the chat gets an error instead of a session with partial context) and returns `{ text, missing }` (`</file>` in content and `"` in paths are escaped). `getConfig` returns `masterContext: []` when `config.json` is missing; `setConfig` (PUT) rejects entries outside the space (400). `createSession` wraps any config/context error as `CONTEXT_INVALID` naming `config.json` and the entry. It passes `text` as `appendSystemPrompt` and stores the requested `masterContext` as `state.contextFiles` plus `missing` as `state.missingContext`; `contextFiles` is `null` when no session exists (cleared on drop/reset/SDK error). Status goes idle only when the in-flight turn counter (`state.inflight`) reaches 0. It applies only when a session is created (first `chat.send` after start/reset/SDK error): it is fixed for the session's life (prompt cache), config edits need "New session". `chat.history`/`chat.status` carry `contextFiles: string[] | null` and `missingContext`. Web `features/context/`: `useSpaceConfig`/`useSetSpaceConfig` (`['config', id]`, invalidated by `fs.changed` of `config.json` in `WorkspacePage`), `ContextToggle` (📌 in `FileTree`), `ContextSummary` (chat header; the "Context changed" banner shows when `contextFiles` is non-null and differs from the config; missing entries get an unpin button; `useToggleContext` is optimistic). `map-events.ts` (`mapSdkMessage`) is the only code that knows SDK message shapes; its fixtures in `claude/__fixtures__/` are real captured messages. Tool permissions go through `canUseTool` -> `permission.request` -> `permission.reply` (no timeout, no remembering; an aborted signal from interrupt/reset drops the request); allow returns `updatedInput: input`, deny returns `Denied by user`. Callbacks of a replaced session are ignored (`state.session !== session`). After an SDK error the session is dropped and the next `chat.send` creates a new one. An interrupted turn still ends with a `result` event (and a status `idle`).
- Security caveat: sessions use `settingSources: ['project']` with `permissionMode: 'default'`, but an opened third-party plugin's `.claude/settings.json` can still add allow rules or hooks that bypass `canUseTool` prompts; only open plugins you trust. `chat.send` claims the session slot synchronously (`state.opening`), and reset bumps `generation` to cancel a creation in flight. The web `useSpaceEvents` is reference-counted per space; a hook mounted after another already subscribed does not get a fresh `chat.history`.
- Claude auth: nothing is configured by the app; the SDK spawns its bundled Claude Code CLI, which uses the user's existing Claude Code login or `ANTHROPIC_API_KEY` from the server's environment. The SDK is ESM-only and stays external in the CJS server bundle (loaded via `require`, needs Node >= 22.12).
- Server `{type:'error'}` WS messages carry `spaceId` when the failing client message had one; the web `useSpaceEvents` routes them to that space. Web `send()` queues non-subscribe messages while the socket is not open and flushes them on connect.
- Theme: `MantineProvider defaultColorScheme="auto"` in `app/app.tsx`; `index.html` has an inline script (same logic as `ColorSchemeScript`, key `mantine-color-scheme-value`) to avoid a flash. `features/theme/ColorSchemeToggle` (SegmentedControl Auto/Light/Dark via `useMantineColorScheme`) sits in the spaces-page and workspace headers. Custom SCSS must use Mantine variables (`var(--mantine-color-default-border)`, `light-dark()`), no color literals; the preset's `@mixin dark/light/hover` cannot be used in SCSS, but `light-dark()` and `rem()` work; Monaco follows `useComputedColorScheme`. Dialogs are Mantine `Modal` (inline per dialog, Enter submits the `<form>`). Web tests run in jsdom with `src/test-setup.ts` (matchMedia, ResizeObserver, scrollIntoView polyfills, wired via `setupFiles` in `vite.config.mts`); `App` includes its own `MantineProvider`.
- Editor: Monaco is loaded from the CDN by `@monaco-editor/react` (no bundling, no CSP); `monaco-editor` is installed only for its types. The editor compares the server content with the last accepted disk content to tell external changes from its own saves.
- Tests that open real sockets use `app.listen({ port: 0 })` and the `ws` client (devDependency). `pnpm dev` cannot run twice at once (Nx serve lock), so run `node apps/server/dist/main.js` directly if another dev session is up.
- The server build uses `bundle: true` so `@pm/protocol` TS source is inlined; npm packages stay external.

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
