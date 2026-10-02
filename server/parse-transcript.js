import { readUtf8File, statReadOnly } from "./read-only.js";

const CONTEXT_WINDOW_TOKENS = 200_000;
const ACTIVE_GAP_MS = 10 * 60 * 1000;
const ACTIVE_CUTOFF_MS = 24 * 60 * 60 * 1000;

function estimateTokens(chars) {
  return Math.max(0, Math.round(chars / 4));
}

function extractTimestamp(text) {
  const m = String(text).match(/<timestamp>([^<]+)<\/timestamp>/);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function extractUserQuery(text) {
  const m = String(text).match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
  return m ? m[1].trim() : null;
}

function normalizeToolName(part) {
  const name = part.name || part.toolName;
  if (!name) return null;
  if (name === "run_terminal_cmd" || name === "Shell") return "Shell";

  if (name === "CallDynamicTool") {
    const args = part.input || part.arguments || {};
    const ns = args.namespace || "cursor";
    const tool = args.toolName || "unknown";
    return `${ns}.${tool}`;
  }

  return name;
}

function relPath(filePath, workspacePath) {
  if (!filePath) return filePath;
  const norm = filePath.replace(/\\/g, "/");
  if (workspacePath) {
    const base = workspacePath.replace(/\\/g, "/").replace(/\/$/, "");
    if (norm.startsWith(base + "/")) return norm.slice(base.length + 1);
    if (norm === base) return pathBasename(norm);
  }
  const home = process.env.HOME?.replace(/\\/g, "/");
  if (home && norm.startsWith(home + "/")) {
    const rest = norm.slice(home.length + 1);
    const idx = rest.indexOf("/");
    if (idx > 0 && idx < rest.length - 1) return rest.slice(idx + 1);
  }
  return norm;
}

function pathBasename(p) {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

function inc(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function toolRecord(map, name, failed = false) {
  const cur = map.get(name) || { name, success: 0, failure: 0 };
  if (failed) cur.failure += 1;
  else cur.success += 1;
  map.set(name, cur);
}

function mapToCountList(map) {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function toolsToArray(toolMap) {
  return [...toolMap.values()].sort(
    (a, b) => b.success + b.failure - (a.success + a.failure)
  );
}

function isContextCompressionRecord(rec) {
  const t = rec?.type;
  if (t === "context_compression" || t === "context_summarized" || t === "conversation_compressed") {
    return true;
  }
  if (rec?.contextCompression === true || rec?.compressed === true) {
    return true;
  }
  return false;
}

/** [REDACTED] in agent transcripts hides prior tool output in exports — not context window compression. */
function isTranscriptRedactionOnly(text) {
  const t = String(text || "").trim();
  return t === "[REDACTED]" || /^(\[REDACTED\]\s*)+$/.test(t);
}

export function parseTranscript(jsonlPath, { chatId, workspacePath, titleFromDb } = {}) {
  const stat = statReadOnly(jsonlPath);
  const raw = readUtf8File(jsonlPath);
  const lines = raw.split("\n").filter((l) => l.trim());

  let userTurns = 0;
  let assistantTurns = 0;
  let assistantChars = 0;
  let conversationChars = 0;
  let rulesChars = 0;
  let systemEstimateChars = 0;
  let summarizedChars = 0;
  let subagentChars = 0;

  const toolMap = new Map();
  const skills = new Map();
  const agents = new Map();
  const commands = new Map();
  const subAgents = [];
  const files = new Map();
  const models = [];
  const timestamps = [];
  const contextSeries = [];

  let cumulativeTokens = estimateTokens(3500);
  let compressEvents = 0;
  let compressionDetectable = false;
  let title = titleFromDb || null;
  let firstQuery = null;
  let toolsInAssistantTurn = [];
  let mcpDynamicCalls = 0;
  let distinctTools = new Set();

  function pushContextPoint(compress = false) {
    const raw = (cumulativeTokens / CONTEXT_WINDOW_TOKENS) * 100;
    const percent =
      cumulativeTokens <= 0
        ? 0
        : Math.min(100, Math.max(1, Math.round(raw)));
    contextSeries.push({ percent, compress });
  }

  function processToolPart(part) {
    const name = normalizeToolName(part);
    if (!name) return;
    distinctTools.add(name);
    toolsInAssistantTurn.push(name);
    toolRecord(toolMap, name, false);

    const input = part.input || part.arguments || {};

    if (name === "cursor.SwitchMode" && input.mode) {
      inc(agents, capitalizeMode(input.mode));
    }
    if (name === "cursor.Task" || part.name === "Task") {
      const type = input.subagent_type || input.subagentType || "Task";
      const heading =
        (input.description || input.prompt || "Sub-agent task")
          .split("\n")[0]
          .slice(0, 120) || "Sub-agent task";
      subAgents.push({ type, heading });
      inc(agents, type);
      subagentChars += estimateTokens(String(input.prompt || input.description || "").length) * 4;
    }
    if (name.endsWith(".Task")) {
      const type = input.subagent_type || name.split(".")[0];
      const heading = (input.description || "Sub-agent task").slice(0, 120);
      subAgents.push({ type, heading });
      inc(agents, type);
    }

    if (name.startsWith("cursor.") === false && name.includes(".")) {
      mcpDynamicCalls += 1;
    }

    if (part.name === "Write" || name === "Write") {
      const p = relPath(input.path, workspacePath);
      if (p) files.set(p, files.has(p) ? files.get(p) : "created"); // keep first action
    }
    if (part.name === "StrReplace" || name === "StrReplace") {
      const p = relPath(input.path, workspacePath);
      if (p) files.set(p, "edited");
    }
    if (part.name === "Delete" || name === "Delete") {
      const p = relPath(input.path, workspacePath);
      if (p) files.set(p, "deleted");
    }

    if (part.name === "Read" || name === "Read") {
      const p = input.path || "";
      const skillMatch = p.match(/skills[/\\]([^/\\]+)[/\\]SKILL\.md/i);
      if (skillMatch) inc(skills, skillMatch[1]);
      const superMatch = p.match(/superpowers[/\\][^/\\]+[/\\]skills[/\\]([^/\\]+)[/\\]SKILL\.md/i);
      if (superMatch) inc(skills, superMatch[1]);
    }
  }

  for (const line of lines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    if (isContextCompressionRecord(rec)) {
      compressionDetectable = true;
      compressEvents += 1;
      cumulativeTokens = Math.max(
        estimateTokens(conversationChars * 0.3),
        Math.round(cumulativeTokens * 0.6)
      );
      pushContextPoint(true);
      continue;
    }

    if (rec.type === "turn_ended") {
      if (rec.status === "error" && toolsInAssistantTurn.length) {
        const failedName = toolsInAssistantTurn[toolsInAssistantTurn.length - 1];
        const cur = toolMap.get(failedName);
        if (cur && cur.success > 0) {
          cur.success -= 1;
          cur.failure += 1;
        } else {
          toolRecord(toolMap, failedName, true);
        }
      }
      toolsInAssistantTurn = [];
      continue;
    }

    const role = rec.role;
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;

    if (role === "user") {
      userTurns += 1;
      toolsInAssistantTurn = [];
      for (const part of content) {
        if (part.type !== "text") continue;
        const text = part.text || "";
        const ts = extractTimestamp(text);
        if (ts) timestamps.push(ts);
        const q = extractUserQuery(text);
        if (q) {
          if (!firstQuery) firstQuery = q;
          if (!title) title = q.split("\n")[0].slice(0, 80);
          for (const m of q.matchAll(/\/([a-zA-Z][\w-]*)/g)) {
            inc(commands, `/${m[1]}`);
          }
        }
        if (text.includes("<user_rules>")) rulesChars += text.length;
        if (text.includes("<available_skills>")) systemEstimateChars += text.length;
        conversationChars += text.length;
        cumulativeTokens += estimateTokens(text.length);
      }
      pushContextPoint(false);
    }

    if (role === "assistant") {
      assistantTurns += 1;
      for (const part of content) {
        if (part.type === "text") {
          const text = part.text || "";
          const usingSkill = text.match(/Using\s+([a-zA-Z0-9_-]+)\s+skill/i);
          if (usingSkill) inc(skills, usingSkill[1]);
          if (!isTranscriptRedactionOnly(text) && !text.includes("<user_query>")) {
            assistantChars += text.length;
            conversationChars += text.length;
            cumulativeTokens += estimateTokens(text.length);
          }
        }
        if (part.type === "tool_use") {
          processToolPart(part);
        }
      }
    }

    if (rec.model && !models.includes(rec.model)) {
      models.push(rec.model);
    }
  }

  if (!title) {
    title = firstQuery?.split("\n")[0]?.slice(0, 80) || `Chat ${chatId?.slice(0, 8) || "session"}`;
  }

  if (contextSeries.length === 0) {
    pushContextPoint(false);
  } else {
    const finalPct = Math.min(
      100,
      Math.max(1, Math.round((cumulativeTokens / CONTEXT_WINDOW_TOKENS) * 100))
    );
    const last = contextSeries[contextSeries.length - 1];
    last.percent = Math.max(last.percent, finalPct);
  }

  timestamps.push(stat.mtimeMs);
  const started = timestamps.length
    ? new Date(Math.min(...timestamps)).toISOString()
    : stat.birthtime.toISOString();
  const lastActive = new Date(Math.max(...timestamps)).toISOString();

  let activeSeconds = 0;
  const sortedTs = [...timestamps].sort((a, b) => a - b);
  for (let i = 1; i < sortedTs.length; i++) {
    const gap = sortedTs[i] - sortedTs[i - 1];
    if (gap > 0 && gap <= ACTIVE_GAP_MS) activeSeconds += Math.round(gap / 1000);
  }
  if (activeSeconds === 0 && sortedTs.length >= 2) {
    activeSeconds = Math.max(
      60,
      Math.round((sortedTs[sortedTs.length - 1] - sortedTs[0]) / 1000)
    );
  }

  const now = Date.now();
  const lastMs = new Date(lastActive).getTime();
  const age = now - lastMs;
  let status = "completed";
  if (age < ACTIVE_CUTOFF_MS && age < 2 * 60 * 60 * 1000) status = "active";
  if (userTurns > 0 && assistantTurns === 0 && age > ACTIVE_CUTOFF_MS) status = "abandoned";
  if (userTurns >= 1 && assistantTurns > 0 && age > 7 * ACTIVE_CUTOFF_MS && userTurns <= 2) {
    status = "abandoned";
  }

  if (agents.size === 0 && assistantTurns > 0) inc(agents, "Agent");

  const skillList = mapToCountList(skills);
  const skillTokens = skillList.reduce((s, x) => s + x.count * 1800, 0);

  const contextBudget = {
    systemPrompts: estimateTokens(systemEstimateChars || 3800),
    toolDefinitions: Math.max(distinctTools.size * 900, 4000),
    rules: estimateTokens(rulesChars || 2000),
    skills: skillTokens,
    mcpDynamicTools: mcpDynamicCalls * 2500,
    subagent: estimateTokens(subagentChars),
    summarizedConversation: compressionDetectable
      ? estimateTokens(summarizedChars || conversationChars * 0.15)
      : 0,
    conversation: estimateTokens(conversationChars),
  };

  return {
    id: chatId,
    title,
    status,
    started,
    lastActive,
    activeSeconds,
    models,
    userTurns,
    assistantTurns,
    assistantChars,
    contextSeries: contextSeries.length ? contextSeries : [{ percent: 0, compress: false }],
    tools: toolsToArray(toolMap),
    skills: skillList,
    agents: mapToCountList(agents),
    commands: mapToCountList(commands),
    subAgents,
    files: [...files.entries()].map(([path, action]) => ({ path, action })),
    contextBudget,
    meta: {
      source: "agent-transcript",
      jsonlPath,
      estimatedContext: true,
      compressionDetectable,
      compressEvents,
    },
  };
}

function capitalizeMode(mode) {
  const m = String(mode).toLowerCase();
  if (m === "plan") return "Plan";
  if (m === "ask") return "Ask";
  if (m === "debug") return "Debug";
  if (m === "agent") return "Agent";
  return mode;
}
