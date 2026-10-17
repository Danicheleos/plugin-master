# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

The repo contains **no code yet**: no build, lint or test commands exist. It holds only two planning documents in `docs/`, written in Russian. `.gitignore` contains `docs/*`, so those files are untracked and exist only locally. Read them before designing anything:

- `docs/idea.md`: the product idea.
- `docs/idea-plan.md`: research and the development plan, including stack, architecture and roadmap.

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
