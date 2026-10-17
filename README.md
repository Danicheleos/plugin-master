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

The server prints `plugin-master: open http://localhost:4200/?token=<token>`. Open that URL: the token is required for every `/api` call.

## Usage

1. Open the printed URL once. The page stores the token in `localStorage` and removes it from the address bar. Without a token the page asks you to open the link from the server console.
2. **New plugin**: enter an absolute path (created if missing), a kebab-case name and a description. This scaffolds a minimal plugin plus `.plugin-master/`.
3. **Open folder**: enter the absolute path of an existing plugin. If the folder has no `.claude-plugin/plugin.json`, choose "Initialize here" to scaffold it in place.
4. Spaces are listed on the home page; "Remove from list" only unregisters a space and never deletes files.
5. **Workspace** (click a space): file tree | Monaco editor | Claude chat. The selected file is kept in the URL (`?file=`). "+" creates a file (folders are created too). Cmd/Ctrl+S saves. Binary files are not shown. Changes made on disk (by you or an agent) appear live over WebSocket: the tree updates, and an open file reloads if it has no unsaved edits, otherwise a banner offers "Reload" / "Keep my edits". Monaco is loaded from a CDN by default, so the editor needs internet access.
6. **Chat** (right column): one Claude session per space, working in the space folder (it picks up the plugin's `CLAUDE.md` and `.claude/`). Enter sends, Shift+Enter adds a newline. Claude's answer streams in, tool calls are shown as collapsible blocks, and every tool that needs permission opens a dialog ("Allow" / "Deny"; there is no timeout and decisions are not remembered). "Stop" interrupts the current answer, "New session" clears the chat. History is kept in server memory only: it survives a page reload but not a server restart.
7. **Master context**: click the 📌 next to a file in the tree to pin it (filled = pinned). Pinned files are put into Claude's system prompt when a session starts, so it knows them without reading. By default `IDEA.md` and `STATE.md` are pinned. The list is `masterContext` in `.plugin-master/config.json` (editable by hand). The chat header shows "Context: N files" (click for the list). The context is fixed per session: after you change it, a notice offers "New session". Pinned files that no longer exist are skipped (the list shows them with "Unpin"); a path outside the space, a directory or a binary file makes the next message fail with an error naming the entry until fixed. A missing `config.json` means an empty context.

The Auto / Light / Dark switch in the page header follows the system theme by default and remembers your choice.

Other commands: `pnpm check` (lint, typecheck, test).

## Environment variables

| Variable      | Default            | Meaning                                             |
| ------------- | ------------------ | --------------------------------------------------- |
| `PM_PORT`     | `4317`             | API server port (binds to 127.0.0.1 only)           |
| `PM_WEB_PORT` | `4200`             | Web dev server port, used for the Origin allowlist  |
| `PM_TOKEN`    | random per start   | Session token                                       |
| `PM_HOME`     | `~/.plugin-master` | Where the spaces registry (`spaces.json`) is stored |
