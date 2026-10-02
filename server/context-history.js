import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LEDGER_DIR = path.join(os.homedir(), ".context-ledger", "history");

function historyPath(composerId) {
  return path.join(LEDGER_DIR, `${composerId}.jsonl`);
}

function ensureDir() {
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
}

export function appendContextSample(composerId, sample) {
  if (!composerId || !sample) return;
  ensureDir();
  const line = JSON.stringify(sample) + "\n";
  fs.appendFileSync(historyPath(composerId), line, "utf8");
}

export function readContextHistory(composerId, { maxPoints = 2000 } = {}) {
  const file = historyPath(composerId);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const points = [];
  for (const line of lines) {
    try {
      points.push(JSON.parse(line));
    } catch {
      /* skip corrupt line */
    }
  }
  if (points.length <= maxPoints) return points;
  return points.slice(-maxPoints);
}

export function detectSummarizationEvent(prev, next) {
  if (!prev || !next) return null;
  const sumDelta = (next.summarizedTokens ?? 0) - (prev.summarizedTokens ?? 0);
  const usedDelta = (next.usedTokens ?? 0) - (prev.usedTokens ?? 0);
  const convDelta =
    (next.conversationTokens ?? 0) - (prev.conversationTokens ?? 0);

  if (sumDelta >= 200 && usedDelta <= -500) return "summarization";
  if (usedDelta <= -3000 && sumDelta >= 0) return "summarization";
  if (convDelta <= -5000 && sumDelta >= 100) return "summarization";
  return null;
}

export function historyLedgerDir() {
  return LEDGER_DIR;
}

export function computeHistoryStats(points) {
  if (!points?.length) {
    return {
      sampleCount: 0,
      peakUsedTokens: null,
      peakPercent: null,
      firstSampleAt: null,
      lastSampleAt: null,
    };
  }
  let peakUsedTokens = 0;
  let peakPercent = 0;
  for (const p of points) {
    if (p.usedTokens != null) peakUsedTokens = Math.max(peakUsedTokens, p.usedTokens);
    if (p.percent != null) peakPercent = Math.max(peakPercent, p.percent);
  }
  return {
    sampleCount: points.length,
    peakUsedTokens: peakUsedTokens || null,
    peakPercent: peakPercent || null,
    firstSampleAt: points[0]?.ts ?? null,
    lastSampleAt: points[points.length - 1]?.ts ?? null,
  };
}
