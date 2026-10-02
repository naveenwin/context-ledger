/**
 * Map Cursor composer status for sub-agent runs (not parent chat status).
 * @param {string|null|undefined} raw
 * @returns {'success'|'aborted'|'failed'|'running'|'unknown'}
 */
export function mapSubagentRunStatus(raw) {
  if (raw == null || raw === "" || raw === "none") return "running";
  const s = String(raw).toLowerCase();
  if (s === "completed" || s === "success") return "success";
  if (s === "aborted" || s === "cancelled" || s === "canceled") return "aborted";
  if (s === "error" || s === "failed" || s === "failure") return "failed";
  if (s === "running" || s === "active" || s === "in_progress") return "running";
  return "unknown";
}

export function normalizeMatchLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {Array<{ type: string, heading: string }>} transcriptAgents
 * @param {Array<{ composerId: string, name: string, type: string, status: string, rawStatus?: string, createdAt?: number }>} composerRuns
 */
export function mergeSubagentStatuses(transcriptAgents, composerRuns) {
  const agents = Array.isArray(transcriptAgents) ? transcriptAgents : [];
  const runs = Array.isArray(composerRuns) ? [...composerRuns] : [];
  runs.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  const used = new Set();

  function pickRun(transcriptAgent, index) {
    const heading = normalizeMatchLabel(transcriptAgent.heading);
    let match = runs.find(
      (r) =>
        !used.has(r.composerId) &&
        (normalizeMatchLabel(r.name) === heading ||
          normalizeMatchLabel(r.name).includes(heading) ||
          heading.includes(normalizeMatchLabel(r.name)))
    );
    if (!match && runs[index] && !used.has(runs[index].composerId)) {
      match = runs[index];
    }
    return match;
  }

  const merged = agents.map((ta, index) => {
    const match = pickRun(ta, index);
    if (match) used.add(match.composerId);
    const status = match ? match.status : "unknown";
    return {
      ...ta,
      status,
      rawStatus: match?.rawStatus ?? null,
      statusSource: match ? "cursor-composer" : "transcript",
      composerId: match?.composerId ?? null,
    };
  });

  for (const run of runs) {
    if (used.has(run.composerId)) continue;
    merged.push({
      type: run.type || "Task",
      heading: run.name || run.type || "Sub-agent",
      status: run.status,
      rawStatus: run.rawStatus ?? null,
      statusSource: "cursor-composer",
      composerId: run.composerId,
    });
  }

  return merged;
}
