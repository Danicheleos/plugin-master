# plugin-master

A local web UI for interactively building Claude Code plugins and skills: manage plugin "spaces", edit files, chat with Claude and pin the context the master agent reads.

## Prerequisites

- Node 22.12 or newer
- pnpm via corepack: `corepack enable pnpm`
- Claude access for the chat: an existing Claude Code login (`claude` works in your terminal) or `ANTHROPIC_API_KEY` set in the environment of the server. The app configures no auth itself; chat messages cost real tokens.

## Install and run

```sh
pnpm install
pnpm dev
```

The server prints `plugin-master: open http://localhost:5100/?token=<token>`. Open that URL: the token is required for every `/api` call.

`pnpm dev` rebuilds and restarts the server whenever server code changes, which kills any running Claude session (exit 143). When you develop plugin-master with its own agent (plugin-master opened as a space), run `pnpm dev:self` instead: the same, without server restarts (restart it by hand to pick up server changes; the web part still hot-reloads).

## Usage

1. Open the printed URL once. The page stores the token in `localStorage` and removes it from the address bar. Without a token the page asks you to open the link from the server console.
2. **New plugin**: choose a parent folder in the folder picker, then enter a kebab-case folder/plugin name and a description. This scaffolds a minimal plugin plus `.plugin-master/`.
3. **Open folder**: choose an existing plugin folder in the folder picker. If the folder has no `.claude-plugin/plugin.json`, choose "Initialize here" to scaffold it in place.
4. Spaces are listed on the home page; "Remove from list" only unregisters a space and never deletes files.
5. **Workspace** (click a space): file tree | Monaco editor | Claude chat. The selected file is kept in the URL (`?file=`). "+" creates a file (folders are created too). Cmd/Ctrl+S saves. Binary files are not shown. The tree loads a folder when you expand it. Only what is shown is watched (the root, expanded folders, the open file and `.plugin-master/`), so large plugins open fast. Changes made on disk (by you or an agent) to those appear live over WebSocket: the tree updates, and an open file reloads if it has no unsaved edits, otherwise a banner offers "Reload" / "Keep my edits". Monaco is loaded from a CDN by default, so the editor needs internet access.
6. **Chat** (right column): Claude working in the space folder (it picks up the plugin's `CLAUDE.md` and `.claude/`). The session selector in the chat header lists past Claude Code sessions of that folder; choosing one loads its history and the next message resumes it. The mode selector in the chat header switches the permission mode: Manual (asks for every tool), Accept edits, Plan (read-only; approving the plan returns to the previous mode), Auto (a classifier decides), Don't ask (only pre-allowed tools). Enter sends, Shift+Enter adds a newline. Claude's answer streams in, tool calls are shown as collapsible blocks, and every tool that needs permission opens a dialog ("Allow" / "Deny"; there is no timeout and decisions are not remembered). "Stop" interrupts the current answer, "New session" starts a fresh one. Sessions are Claude Code's own transcripts (`~/.claude/projects/`), so they survive restarts; costs of past turns are not shown.
   Features menu → "Use my Claude settings" (off by default) lets the chat agent load your `~/.claude` settings, plugins, skills and MCP servers; a copy of the plugin you are developing installed there may interfere. It applies to new sessions.

7. **Plans** (panel at the top of the chat): the master agent follows the active plan phase by phase through its own plan tools (no permission prompt; they only write `.plugin-master/plans/`). "New plan" takes a title and a goal and can ask the agent to draft phases; the selector switches the active plan, and "Detach" turns plans off (the agent then works without a plan until you pick one again). A phase that needs its own plan gets a child plan; when the child is done, the parent continues. The panel shows progress, phases, the current action, the log, the master's context size and running subagents/tasks (their token usage).
8. **Evals** (tab next to the editor): results of `claude plugin eval` found under the plugin's eval dir (`evals/` or `plugin.json` `experimental.evals`) in `results/**/aggregate-result.json`: runs list (score, cases passed, cost, duration, Claude version, partial/skipped badges), then case → arm → run → grader verdicts with explanations, judge votes and evidence, and the HTML report in a sandboxed frame. New runs appear live while the tab is open. "Run evals" starts `claude plugin eval` for the space (case glob, tags, runs, model, required cost limit) with live output and Cancel; dropdowns come from the suite's cases and tags; several cases run one after another and group together; "Compare with a no-plugin baseline" (off by default) doubles the cost. The list is grouped by suite (the plugin's own and baseline suites such as a separate bare suite are never mixed), then by case (latest score, baseline delta, trend), then by the baseline each run was compared with (its own no-plugin arm, else the latest bare run of that case with the same model; "Invocations" shows the raw run batches). "Build eval suite with agent" asks the master agent to design and write cases. Each run's metrics (turns, model/tool calls, max context, cost, duration, subagents) and its turn-by-turn trace are shown; "Compare with…" puts a baseline (the no-plugin arm or any other group, e.g. a separate bare suite) side by side. The first run asks you to confirm that you trust the plugin (evals run its code and prompts on your machine, and every run is a billed Claude session).
9. **Master context**: click the 📌 next to a file in the tree to pin it (filled = pinned). Pinned files are put into Claude's system prompt when a session starts, so it knows them without reading. By default `IDEA.md` and `STATE.md` are pinned. The list is `masterContext` in `.plugin-master/config.json` (editable by hand). The chat header shows "Context: N files" (click for the list; every entry has "Unpin"). The context is fixed per session: after you change it, a notice offers "New session". Pinned files that no longer exist are skipped (marked "file not found"); a path outside the space, a directory or a binary file makes the next message fail with an error naming the entry until fixed. A missing `config.json` means an empty context.

The Auto / Light / Dark switch in the page header follows the system theme by default and remembers your choice.

Other commands: `pnpm check` (lint, typecheck, test).

### Live progress of an external eval series

A plugin with its own eval runner can show a running series in the Evals tab by writing `<evalDir>/results/running.json` (`evalDir` is `evals/` or `plugin.json` `experimental.evals`). The tab polls every 5 s while the file is live and refreshes the runs list when the series finishes.

```json
{
  "kind": "eval-series",
  "series": "name of the series",
  "arm": "plugin",
  "startedAt": "2026-10-23T12:00:00Z",
  "updatedAt": "2026-10-23T12:03:00Z",
  "finishedAt": null,
  "runsPerCase": 3,
  "total": 2,
  "done": 1,
  "current": "case-b",
  "costUsd": 0.4,
  "cases": [
    { "name": "case-a", "state": "done", "score": 0.8, "costUsd": 0.4 },
    { "name": "case-b", "state": "running", "score": null, "costUsd": null }
  ]
}
```

- `arm` is `plugin` or `bare`; case `state` is `queued`, `running`, `done` or `failed`; `finishedAt`, `current`, `score` and case `costUsd` are `null` when unknown or not reached. Timestamps are ISO 8601.
- Do not add a `schemaVersion` key: top-level `results/*.json` files with one are listed as runs.
- The series is hidden when the file is missing or does not match this shape, when `finishedAt` is older than 2 minutes, or when `updatedAt` is older than 30 minutes (there is no process check, so refresh `updatedAt` at least that often between commands, and set `finishedAt` at the end).
- Write atomically (write a temp file in the same dir, then rename) so the reader never sees half a file.

## Environment variables

| Variable            | Default                    | Meaning                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PM_PORT`           | `4317`                     | API server port (binds to 127.0.0.1 only)                                                                                                                                                                                                                                                                                                                                 |
| `PM_WEB_PORT`       | `5100`                     | Web dev server port, used for the Origin allowlist                                                                                                                                                                                                                                                                                                                        |
| `PM_LAN`            | unset                      | `1` (or `pnpm dev:lan` / `pnpm dev:self:lan`) opens the web UI to the local network: Vite listens on all interfaces, the API stays on 127.0.0.1, this machine's LAN IPs are allowed as Host/Origin, the token is still required. Anyone on the network with the token can drive the agent on this machine, and the Vite dev server serves the app source without a token. |
| `PM_TOKEN`          | from `$PM_HOME/token.json` | Session token (fixed value; disables rotation)                                                                                                                                                                                                                                                                                                                            |
| `PM_TOKEN_TTL_DAYS` | 7                          | Saved token is reused across restarts and rotated at the first start after this many days                                                                                                                                                                                                                                                                                 |
| `PM_HOME`           | `~/.plugin-master`         | Where the spaces registry (`spaces.json`) is stored                                                                                                                                                                                                                                                                                                                       |
---



Матрица
| # | Стек | Основной дефект | Второй дефект | |---|---|---|---| | 1 | ts | Политика, правило команды: импорт из чужого контекста мимо index.ts | — | | 2 | ts | Раздутая реализация: иерархия стратегий и фабрика вместо существующей функции расчёта | лишние комментарии, пересказывающие код | | 3 | ts | Тесты: новая ветка createX с новым DomainError без теста, ассерт в старом тесте ослаблен до toBeTruthy | политика, собранная init: событие названо не по схеме <context>.<past-tense-verb> | | 4 | py | Политика, собранная init: ошибка без кода TW-nnn | — | | 5 | py | Корректность: граничная ошибка в расчёте окна | мёртвый код (оставлен неиспользуемый хелпер) | | 6 | py | Контроль: новый плагин по всем конвенциям (PLUGIN = SourcePlugin, keyword-only аргументы, имена тестов) | — | | 7 | go | Архитектура, нигде не записана: HTTP-хендлер ходит в storage мимо сервисного слоя, нет конструктора New… и interface assertion | — | | 8 | go | Ошибки: проглоченная ошибка, при сбое возвращается успех | дублирование: тело функции скопировано из соседнего пакета | | 9 | go | Политика, правило команды: time.Now() вместо core.Clock | — | | 10 | jvm | Code-style, выводится из кода: use case через execute() вместо operator fun invoke, логи склейкой строк вместо key-value | плохие имена (data, tmp, handle2) | | 11 | jvm | Переусложнение: обобщённый репозиторий и builder ради одного вызова | — | | 12 | jvm | Корректность: перепутано сравнение в правиле отказа | тесты: нет теста, который поймал бы эту ошибку | | 13 | mono | Безопасность: в dashboard непроверенный ввод попадает в запрос или HTML | политика, правило команды: ручная правка в __generated__/ | | 14 | mono | Контроль: изменение в Rust с expect("invariant: …") и единицами _dc | — |