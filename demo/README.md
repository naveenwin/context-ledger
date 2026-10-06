# Demo preview

**[Open demo in your browser](https://htmlpreview.github.io/?https://github.com/naveenwin/context-ledger/blob/main/demo/dashboard-preview.html)** — static chat dashboard with fictional repos and chats (no Cursor install, no local server).

Locally: open [`dashboard-preview.html`](./dashboard-preview.html) or run `npm run demo` from the repo root (macOS).

## What the demo shows

- Layout and sections match the live app: context, composition, tools, **Skills · Agents · Commands**, sub-agents, files.
- **Commands** sample reflects current behavior: global `~/.cursor/commands` slash prompts (e.g. `/code-review`) and diff-tab actions (e.g. **Commit & push (diff tab)**)—not file-path `/fragments`.
- **Download PDF** appears in the chat header (same placement as live UI). In the demo it only explains that export works after `npm start`; the live app generates the PDF from your browser.

## What requires the real app

| Feature | Demo | `npm start` |
|--------|------|-------------|
| Real chats / metrics | Fictional | From `~/.cursor` |
| Context ledger chart | Illustration | `~/.context-ledger/history/` |
| Download PDF | Button + notice | Full export |
| Command counts | Sample rows | Parsed from your transcripts |

Repo sidebar rows in the demo toggle expand/collapse when you click the project name or chevron.
