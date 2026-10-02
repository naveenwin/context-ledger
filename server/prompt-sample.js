import { appendContextSample, detectSummarizationEvent, readContextHistory } from "./context-history.js";
import { sampleComposerContext } from "./cursor-composer.js";

const COMPOSER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const seenGenerations = new Set();

export function isComposerId(id) {
  return typeof id === "string" && COMPOSER_ID.test(id);
}

export function isGenerationId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 200 && !/[\u0000-\u001f]/.test(id);
}

export function selectPromptBars(points, limit = 20) {
  if (!Array.isArray(points)) return [];
  return points.filter((point) => point && point.trigger === "user_prompt").slice(-limit);
}

export function recordPromptSample(conversationId, generationId, { model } = {}, deps = defaultDeps()) {
  if (!isComposerId(conversationId) || !isGenerationId(generationId)) {
    return { recorded: false, reason: "invalid" };
  }

  const key = `${conversationId}:${generationId}`;
  if (deps.seen.has(key)) return { recorded: false, reason: "duplicate" };

  const points = deps.readHistory(conversationId);
  if (points.some((point) => point.trigger === "user_prompt" && point.generationId === generationId)) {
    deps.seen.add(key);
    return { recorded: false, reason: "duplicate" };
  }

  deps.seen.add(key);
  let snap;
  try {
    snap = deps.sampleContext(conversationId);
  } catch {
    deps.seen.delete(key);
    return { recorded: false, reason: "sample_failed" };
  }
  if (!snap) {
    deps.seen.delete(key);
    return { recorded: false, reason: "no_snapshot" };
  }

  const prev = points.length ? points[points.length - 1] : null;
  const event = deps.detectEvent ? deps.detectEvent(prev, snap) : null;
  try {
    const modelLabel = typeof model === "string" ? model.trim() : "";
    deps.appendSample(conversationId, {
      ...snap,
      trigger: "user_prompt",
      generationId,
      event,
      ...(modelLabel ? { model: modelLabel } : {}),
    });
  } catch {
    deps.seen.delete(key);
    return { recorded: false, reason: "append_failed" };
  }
  return { recorded: true };
}

function defaultDeps() {
  return {
    readHistory: readContextHistory,
    appendSample: appendContextSample,
    sampleContext: sampleComposerContext,
    detectEvent: detectSummarizationEvent,
    seen: seenGenerations,
  };
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function respondCreated(res, deps, after) {
  if (res.headersSent) {
    after?.();
    return;
  }
  res.writeHead(201, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end('{"ok":true}\n');
  deps.onResponded?.(201);
  if (after) setTimeout(after, 0);
}

export function handlePromptPing(req, res, deps = defaultDeps()) {
  readBody(req)
    .then((raw) => {
      let conversationId = "";
      let generationId = "";
      let model = "";
      try {
        const body = JSON.parse(raw || "{}");
        conversationId = body.conversationId;
        generationId = body.generationId;
        model = body.model || "";
      } catch {
        /* still release the hook */
      }
      respondCreated(res, deps, () => {
        try {
          const result = recordPromptSample(conversationId, generationId, { model }, deps);
          if (!result.recorded && result.reason !== "duplicate") {
            console.error(`prompt sample skipped (${result.reason})`);
          }
        } catch (err) {
          console.error("prompt sample failed", err?.message || err);
        }
      });
    })
    .catch(() => {
      respondCreated(res, deps);
    });
}
