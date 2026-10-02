# Context Ledger

Local dashboard for **Cursor agent chat transcripts** (`~/.cursor/projects/*/agent-transcripts/*.jsonl`).

## Read-only access

Context Ledger **never writes** to Cursor directories. It only:

- Opens files with `O_RDONLY` (see `server/read-only.js`)
- Reads agent transcript JSONL (append-only logs Cursor already wrote)

When we add `store.db` (phase B), SQLite will use `?mode=ro&immutable=1` so we do not participate in WAL writes or block Cursor’s normal work.

**Context Usage panel:** for each chat whose id matches a composer session, we read `composerData:<id>` and `composerHeaders` from `globalStorage/state.vscdb` (read-only) — the same `promptTokenBreakdown` Cursor shows in the IDE (system prompt, tools, rules, skills, MCP, subagents, conversation).

## Run

```bash
npm start
```

Open [http://localhost:3847](http://localhost:3847).

Refresh data: `curl http://localhost:3847/api/refresh` or reload the page (30s server cache).

## Context memory (local ledger)

While `npm start` is running, the server **writes only** to `~/.context-ledger/history/<composerId>.jsonl`:

- Every **10 minutes**: find composers with `lastUpdatedAt` within the **last hour** (max **5**), add to the watch set
- Every **15 seconds**: sample context % / tokens for watched chats; stop sampling a chat when Cursor idle **> 1 hour**
- Summarization events are inferred when summarized tokens rise and used tokens drop between samples

API: `GET /api/history/<chatId>`, `GET /api/watch/status`

## What is parsed today

- Tools, skills, slash commands, files touched, turns, assistant output size
- Sub-agents from `Task` / `cursor.Task` tool calls
- **Estimated** context % and composition (labeled in the UI)

## Chat storage (why multiple places)

| Location | Role |
|----------|------|
| `~/.cursor/projects/<workspace>/agent-transcripts/*.jsonl` | Durable log of **agent** sessions (tools, sub-agents) — **used by Context Ledger v1** |
| `~/.cursor/chats/<hash>/<id>/store.db` | SQLite blobs for **Composer/UI** chat state (messages, tool results) |
| `Library/Application Support/Cursor/.../workspaceStorage` | VS Code–style workspace metadata |
| `~/.cursor/ai-tracking/ai-code-tracking.db` | AI code attribution summaries (optional future source) |

v1 reads **agent transcripts** only. Adding `store.db` would list more Composer chats but needs separate parsers.
