import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSqliteReadOnlyUri } from "./read-only.js";
import { CURSOR_APP_SUPPORT } from "./paths.js";
import { mapSubagentRunStatus } from "./subagent-status.js";

const CATEGORY_TO_BUDGET_KEY = {
  system_prompt: "systemPrompts",
  tools: "toolDefinitions",
  rules: "rules",
  skills: "skills",
  mcp: "mcpDynamicTools",
  subagents: "subagent",
  summarized_conversation: "summarizedConversation",
  conversation: "conversation",
};

function globalStateDbPath() {
  return path.join(CURSOR_APP_SUPPORT, "User", "globalStorage", "state.vscdb");
}

let db = null;

function getGlobalDb() {
  if (!db) {
    db = new DatabaseSync(openSqliteReadOnlyUri(globalStateDbPath()), {
      readOnly: true,
      enableForeignKeyConstraints: false,
    });
  }
  return db;
}

function resetGlobalDb() {
  try {
    db?.close();
  } catch {
    /* connection already unusable */
  }
  db = null;
}

function parseJsonValue(raw) {
  if (raw == null) return null;
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function budgetFromBreakdown(breakdown) {
  const budget = {
    systemPrompts: 0,
    toolDefinitions: 0,
    rules: 0,
    skills: 0,
    mcpDynamicTools: 0,
    subagent: 0,
    summarizedConversation: 0,
    conversation: 0,
  };
  if (!breakdown?.categories) return budget;
  for (const cat of breakdown.categories) {
    const key = CATEGORY_TO_BUDGET_KEY[cat.id];
    if (key) budget[key] = cat.estimatedTokens ?? 0;
  }
  return budget;
}

function mapComposerStatus(raw) {
  if (raw == null || raw === "none") return null;
  if (raw === "completed") return "completed";
  // Cursor "aborted" = user stopped generation, not an abandoned chat.
  if (raw === "aborted") return "completed";
  return raw;
}

function capitalizeMode(mode) {
  const m = String(mode || "").toLowerCase();
  if (m === "plan") return "Plan";
  if (m === "ask") return "Ask";
  if (m === "debug") return "Debug";
  if (m === "agent") return "Agent";
  if (!m) return null;
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function relPathFromFileUri(uri, workspacePath) {
  if (!uri) return uri;
  let filePath = uri;
  if (String(uri).startsWith("file://")) {
    try {
      filePath = fileURLToPath(uri);
    } catch {
      filePath = decodeURIComponent(String(uri).replace(/^file:\/\//, ""));
    }
  }
  const norm = filePath.replace(/\\/g, "/");
  if (workspacePath) {
    const base = workspacePath.replace(/\\/g, "/").replace(/\/$/, "");
    if (norm.startsWith(base + "/")) return norm.slice(base.length + 1);
    if (norm === base) return path.basename(norm);
  }
  const home = process.env.HOME?.replace(/\\/g, "/");
  if (home && norm.startsWith(home + "/")) {
    const rest = norm.slice(home.length + 1);
    const idx = rest.indexOf("/");
    if (idx > 0 && idx < rest.length - 1) return rest.slice(idx + 1);
  }
  return norm;
}

function countConversationHeaders(composer) {
  const headers = composer.fullConversationHeadersOnly || [];
  let user = 0;
  let assistantBubbles = 0;
  for (const h of headers) {
    if (h.type === 1) user += 1;
    if (h.type === 2) assistantBubbles += 1;
  }
  return { user, assistantBubbles };
}

function filesFromComposer(composer, workspacePath) {
  const states = composer.originalFileStates;
  if (!states || typeof states !== "object") return [];

  return Object.entries(states).map(([uri, meta]) => ({
    path: relPathFromFileUri(uri, workspacePath),
    action: meta?.isNewlyCreated ? "created" : "edited",
  }));
}

function isoFromMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Live metrics from Cursor globalStorage (composerHeaders + composerData).
 * Opens the DB read-only only; never writes.
 */
/** Recent composers by Cursor lastUpdatedAt (read-only). */
export function listWarmComposers({ withinMs = 60 * 60 * 1000, limit = 5 } = {}) {
  try {
    const database = getGlobalDb();
    const cutoff = Date.now() - withinMs;
    const rows = database
      .prepare(
        `SELECT composerId, value FROM composerHeaders
         WHERE CAST(json_extract(value, '$.lastUpdatedAt') AS INTEGER) > ?
         ORDER BY CAST(json_extract(value, '$.lastUpdatedAt') AS INTEGER) DESC
         LIMIT ?`
      )
      .all(cutoff, limit);

    return rows
      .map((row) => {
        const header = parseJsonValue(row.value);
        if (!header) return null;
        return {
          composerId: row.composerId,
          name: header.name || null,
          lastUpdatedAt: header.lastUpdatedAt,
          contextUsagePercent: header.contextUsagePercent ?? null,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Lightweight snapshot for context history polling. */
export function sampleComposerContext(composerId) {
  try {
    return readComposerSnapshot(composerId);
  } catch {
    // immutable=1 connections go stale when Cursor writes state.vscdb.
    resetGlobalDb();
    try {
      return readComposerSnapshot(composerId);
    } catch {
      return null;
    }
  }
}

function readComposerSnapshot(composerId) {
    const database = getGlobalDb();
    const headerRow = database
      .prepare("SELECT value FROM composerHeaders WHERE composerId = ?")
      .get(composerId);
    const dataRow = database
      .prepare("SELECT value FROM cursorDiskKV WHERE key = ?")
      .get(`composerData:${composerId}`);

    if (!dataRow?.value) return null;

    const composer = parseJsonValue(dataRow.value);
    if (!composer) return null;

    const header = headerRow?.value ? parseJsonValue(headerRow.value) : null;
    const breakdown = composer.promptTokenBreakdown;
    const budget = budgetFromBreakdown(breakdown);

    const percent =
      composer.contextUsagePercent ??
      header?.contextUsagePercent ??
      (breakdown?.totalUsedTokens && breakdown?.maxTokens
        ? (breakdown.totalUsedTokens / breakdown.maxTokens) * 100
        : null);

    const limitTokens =
      composer.contextTokenLimit ?? breakdown?.maxTokens ?? 200_000;
    const usedTokens =
      composer.contextTokensUsed ??
      breakdown?.totalUsedTokens ??
      (percent != null ? Math.round((percent / 100) * limitTokens) : null);

    const lastUpdatedAt = header?.lastUpdatedAt ?? composer.lastUpdatedAt;
    if (lastUpdatedAt == null) return null;

    return {
      ts: new Date().toISOString(),
      lastUpdatedAt,
      percent: percent != null ? Math.round(percent * 10) / 10 : null,
      usedTokens,
      limitTokens,
      summarizedTokens: budget.summarizedConversation,
      conversationTokens: budget.conversation,
      budget,
    };
}

export function loadComposerTelemetry(composerId, { workspacePath } = {}) {
  try {
    const database = getGlobalDb();
    const headerRow = database
      .prepare("SELECT value FROM composerHeaders WHERE composerId = ?")
      .get(composerId);
    const dataRow = database
      .prepare("SELECT value FROM cursorDiskKV WHERE key = ?")
      .get(`composerData:${composerId}`);

    if (!dataRow?.value) return null;

    const composer = parseJsonValue(dataRow.value);
    if (!composer) return null;

    const header = headerRow?.value ? parseJsonValue(headerRow.value) : null;
    const breakdown = composer.promptTokenBreakdown;
    const percent =
      composer.contextUsagePercent ??
      header?.contextUsagePercent ??
      (breakdown?.totalUsedTokens && breakdown?.maxTokens
        ? (breakdown.totalUsedTokens / breakdown.maxTokens) * 100
        : null);

    const hasContextBreakdown = percent != null || breakdown != null;
    const latestPercent = Math.min(100, Math.round(percent ?? 0));
    const summarized = budgetFromBreakdown(breakdown).summarizedConversation;

    const createdMs = header?.createdAt ?? composer.createdAt;
    const updatedMs = header?.lastUpdatedAt ?? composer.lastUpdatedAt;
    const started = isoFromMs(createdMs);
    const lastActive = isoFromMs(updatedMs);

    let sessionSeconds = null;
    if (
      createdMs != null &&
      updatedMs != null &&
      updatedMs >= createdMs &&
      updatedMs - createdMs < 30 * 24 * 60 * 60 * 1000
    ) {
      sessionSeconds = Math.round((updatedMs - createdMs) / 1000);
    }

    const status = mapComposerStatus(composer.status ?? header?.status);
    const turnCounts = countConversationHeaders(composer);
    const unifiedMode = header?.unifiedMode ?? composer.unifiedMode;
    const modeLabel = capitalizeMode(unifiedMode);

    const modelName =
      composer.modelConfig?.modelName ||
      composer.modelConfig?.selectedModels?.[0]?.modelId ||
      null;

    const composerFiles = filesFromComposer(composer, workspacePath);
    const filesChangedCount =
      header?.filesChangedCount ?? composer.filesChangedCount ?? composerFiles.length;

    const numSubComposers =
      header?.numSubComposers ??
      (Array.isArray(composer.subagentComposerIds)
        ? composer.subagentComposerIds.length
        : null);

    const fieldSources = {
      title: header?.name || composer.name ? "cursor-composer" : null,
      status: status ? "cursor-composer" : null,
      started: started ? "cursor-composer" : null,
      lastActive: lastActive ? "cursor-composer" : null,
      activeSeconds: sessionSeconds != null ? "cursor-composer-session-span" : null,
      userTurns: turnCounts.user > 0 ? "cursor-composer" : null,
      assistantTurns: "agent-transcript",
      contextBudget: hasContextBreakdown ? "cursor-composer" : null,
      contextSeries: hasContextBreakdown ? "cursor-composer" : null,
      models: modelName ? "cursor-composer" : null,
      agents: modeLabel ? "cursor-composer" : null,
      files: composerFiles.length ? "cursor-composer" : null,
      filesChangedCount: filesChangedCount != null ? "cursor-composer" : null,
      subAgents: numSubComposers != null ? "cursor-composer" : null,
      tools: "agent-transcript",
      skills: "agent-transcript",
      commands: "agent-transcript",
      assistantChars: "agent-transcript",
    };

    const contextTokensUsed =
      composer.contextTokensUsed ??
      breakdown?.totalUsedTokens ??
      (percent != null && (composer.contextTokenLimit ?? breakdown?.maxTokens)
        ? Math.round(
            (percent / 100) * (composer.contextTokenLimit ?? breakdown?.maxTokens ?? 200_000)
          )
        : null);

    return {
      title: header?.name || composer.name || null,
      status,
      started,
      lastActive,
      sessionSeconds,
      userTurns: turnCounts.user > 0 ? turnCounts.user : null,
      composerAssistantBubbles: turnCounts.assistantBubbles,
      models: modelName ? [modelName] : [],
      agents: modeLabel ? [{ name: modeLabel, count: 1 }] : [],
      files: composerFiles,
      filesChangedCount,
      numSubComposers,
      contextUsagePercent: percent,
      contextTokensUsed,
      contextTokenLimit: composer.contextTokenLimit ?? breakdown?.maxTokens ?? 200_000,
      contextBudget: breakdown?.categories ? budgetFromBreakdown(breakdown) : null,
      contextSeries: percent != null ? [{ percent: latestPercent, compress: false }] : null,
      compressEvents: summarized > 0 ? 1 : 0,
      meta: {
        contextSource: percent != null || breakdown?.categories ? "cursor-composer" : null,
        estimatedContext: !(percent != null || breakdown?.categories),
        compressionDetectable: true,
        compressEvents: summarized > 0 ? 1 : 0,
        composerLinked: true,
        fieldSources,
        composerAssistantBubbles: turnCounts.assistantBubbles,
      },
    };
  } catch {
    return null;
  }
}

function mergeContextSeries(transcriptSeries, telemetry) {
  const series = Array.isArray(transcriptSeries) ? [...transcriptSeries] : [];
  const pct =
    telemetry?.contextUsagePercent != null
      ? Math.min(100, Math.round(telemetry.contextUsagePercent))
      : null;

  if (pct == null) return series.length ? series : [{ percent: 0, compress: false }];

  if (series.length === 0) {
    return [{ percent: pct, compress: false }, { percent: pct, compress: false }];
  }

  const last = series[series.length - 1];
  series[series.length - 1] = { ...last, percent: pct };
  return series;
}

function findSubagentChildIds(parentComposerId) {
  const database = getGlobalDb();
  const pattern = `%"parentComposerId":"${parentComposerId}"%`;
  const rows = database
    .prepare(
      `SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND CAST(value AS TEXT) LIKE ?`
    )
    .all(pattern);
  return rows.map((r) => String(r.key).replace(/^composerData:/, ""));
}

/** Sub-agent runs for a parent chat/composer id (read-only Cursor global storage). */
export function loadSubagentRuns(parentComposerId) {
  if (!parentComposerId) return [];
  try {
    const database = getGlobalDb();
    const dataRow = database
      .prepare("SELECT value FROM cursorDiskKV WHERE key = ?")
      .get(`composerData:${parentComposerId}`);
    const parent = dataRow?.value ? parseJsonValue(dataRow.value) : null;
    let ids = Array.isArray(parent?.subagentComposerIds)
      ? [...parent.subagentComposerIds]
      : [];
    if (!ids.length) {
      ids = findSubagentChildIds(parentComposerId);
    }

    const runs = [];
    for (const childId of ids) {
      const childRow = database
        .prepare("SELECT value FROM cursorDiskKV WHERE key = ?")
        .get(`composerData:${childId}`);
      if (!childRow?.value) continue;
      const composer = parseJsonValue(childRow.value);
      if (!composer?.subagentInfo) continue;

      const headerRow = database
        .prepare("SELECT value FROM composerHeaders WHERE composerId = ?")
        .get(childId);
      const header = headerRow?.value ? parseJsonValue(headerRow.value) : null;
      const rawStatus = composer.status ?? header?.status ?? null;

      runs.push({
        composerId: childId,
        name: header?.name || composer.name || null,
        type: composer.subagentInfo?.subagentTypeName || null,
        rawStatus,
        status: mapSubagentRunStatus(rawStatus),
        createdAt: header?.createdAt ?? composer.createdAt ?? null,
      });
    }
    return runs;
  } catch {
    resetGlobalDb();
    return [];
  }
}

export function mergeModelLists(...lists) {
  const out = [];
  for (const list of lists) {
    for (const raw of list || []) {
      const name = typeof raw === "string" ? raw.trim() : "";
      if (!name) continue;
      if (!out.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
        out.push(name);
      }
    }
  }
  return out;
}

export function applyComposerTelemetry(chat, telemetry) {
  if (!telemetry) return chat;

  const mergedMeta = {
    ...chat.meta,
    ...telemetry.meta,
    fieldSources: {
      ...(chat.meta?.fieldSources || {}),
      ...(telemetry.meta?.fieldSources || {}),
    },
  };

  if (telemetry.contextUsagePercent != null) {
    mergedMeta.contextTokensUsed = telemetry.contextTokensUsed;
    mergedMeta.contextTokenLimit = telemetry.contextTokenLimit;
    mergedMeta.contextUsagePercent = telemetry.contextUsagePercent;
  }

  const agents =
    telemetry.agents?.length && telemetry.meta?.fieldSources?.agents === "cursor-composer"
      ? telemetry.agents
      : chat.agents;

  const files =
    telemetry.files?.length && telemetry.meta?.fieldSources?.files === "cursor-composer"
      ? telemetry.files
      : chat.files;

  return {
    ...chat,
    title: telemetry.title || chat.title,
    status: telemetry.status || chat.status,
    started: telemetry.started || chat.started,
    lastActive: telemetry.lastActive || chat.lastActive,
    activeSeconds: telemetry.sessionSeconds ?? chat.activeSeconds,
    userTurns: telemetry.userTurns ?? chat.userTurns,
    models: mergeModelLists(chat.models, telemetry.models),
    agents,
    files,
    contextBudget: telemetry.contextBudget || chat.contextBudget,
    contextSeries: mergeContextSeries(chat.contextSeries, telemetry),
    meta: {
      ...mergedMeta,
      filesChangedCount: telemetry.filesChangedCount ?? mergedMeta.filesChangedCount,
      numSubComposers: telemetry.numSubComposers ?? mergedMeta.numSubComposers,
    },
  };
}
