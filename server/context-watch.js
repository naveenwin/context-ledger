import {
  appendContextSample,
  detectSummarizationEvent,
} from "./context-history.js";
import {
  listWarmComposers,
  sampleComposerContext,
} from "./cursor-composer.js";

export const DISCOVERY_INTERVAL_MS = 10 * 60 * 1000;
export const SAMPLE_INTERVAL_MS = 15 * 1000;
export const COMPOSER_IDLE_MS = 60 * 60 * 1000;
export const MAX_ACTIVE_POLLS = 5;

const lastSamples = new Map();
let activeComposerIds = [];
let discoveryTimer = null;
let sampleTimer = null;
let lastDiscoveryAt = null;
let lastSampleAt = null;

function runDiscovery() {
  lastDiscoveryAt = new Date().toISOString();
  const warm = listWarmComposers({ withinMs: COMPOSER_IDLE_MS, limit: MAX_ACTIVE_POLLS });
  activeComposerIds = warm.map((w) => w.composerId);
}

function runSampleTick() {
  const now = Date.now();
  lastSampleAt = new Date().toISOString();
  const stillActive = [];

  for (const composerId of activeComposerIds) {
    const snap = sampleComposerContext(composerId);
    if (!snap) continue;
    if (now - snap.lastUpdatedAt > COMPOSER_IDLE_MS) continue;

    const prev = lastSamples.get(composerId);
    const event = detectSummarizationEvent(prev, snap);
    appendContextSample(composerId, { ...snap, event, trigger: "poll" });
    lastSamples.set(composerId, snap);
    stillActive.push(composerId);
  }

  activeComposerIds = stillActive;
}

export function startContextWatchManager() {
  if (discoveryTimer) return;

  runDiscovery();
  runSampleTick();

  discoveryTimer = setInterval(runDiscovery, DISCOVERY_INTERVAL_MS);
  sampleTimer = setInterval(runSampleTick, SAMPLE_INTERVAL_MS);
}

export function stopContextWatchManager() {
  if (discoveryTimer) clearInterval(discoveryTimer);
  if (sampleTimer) clearInterval(sampleTimer);
  discoveryTimer = null;
  sampleTimer = null;
}

export function getWatchStatus() {
  return {
    activeComposerIds,
    maxActive: MAX_ACTIVE_POLLS,
    discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    composerIdleMs: COMPOSER_IDLE_MS,
    lastDiscoveryAt,
    lastSampleAt,
  };
}
