import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIFF_TAB_ACTION_RE =
  /^Execute the selected diff-tab ([\w-]+) action\.?$/i;

const DIFF_TAB_LABELS = {
  "commit-and-push": "Commit & push (diff tab)",
};

export function globalCommandsDir() {
  return path.join(os.homedir(), ".cursor", "commands");
}

/** Basenames of `~/.cursor/commands/*.md` (project commands are ignored). */
export function listGlobalSlashCommandSlugs(commandsDir = globalCommandsDir()) {
  if (!fs.existsSync(commandsDir)) return [];
  return fs
    .readdirSync(commandsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -".md".length))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function slashCatalog(slugs) {
  const map = new Map();
  for (const slug of slugs || []) {
    map.set(String(slug).toLowerCase(), `/${slug}`);
  }
  return map;
}

export function labelDiffTabAction(slug) {
  const key = String(slug || "").toLowerCase();
  return DIFF_TAB_LABELS[key] || `Diff tab: ${slug}`;
}

/** Cursor diff-tab UI prompts. */
export function detectCursorUiCommands(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];

  const match = trimmed.match(DIFF_TAB_ACTION_RE);
  if (!match) return [];

  return [labelDiffTabAction(match[1])];
}

/** Slash commands from ~/.cursor/commands only (whitelist). */
export function detectGlobalSlashCommands(text, globalSlugs) {
  const catalog = slashCatalog(globalSlugs);
  if (!catalog.size) return [];

  const trimmed = String(text || "").trim();
  if (!trimmed) return [];

  const found = new Set();
  const lead = trimmed.match(/^\/([A-Za-z][\w-]*)(?=\s|$)/);
  if (lead) {
    const label = catalog.get(lead[1].toLowerCase());
    if (label) found.add(label);
  }

  for (const [lower, label] of catalog) {
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pathRe = new RegExp(
      `(?:~\\/\\.cursor\\/commands\\/|\\.cursor\\/commands/)${escaped}\\.md`,
      "i"
    );
    if (pathRe.test(trimmed)) found.add(label);
  }

  return [...found];
}

export function detectChatCommands(text, globalSlugs) {
  return [
    ...detectGlobalSlashCommands(text, globalSlugs),
    ...detectCursorUiCommands(text),
  ];
}

export function mergeCommandCountLists(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      if (!row?.name) continue;
      map.set(row.name, (map.get(row.name) || 0) + (row.count || 0));
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
