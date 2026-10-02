import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { handlePromptPing, recordPromptSample, selectPromptBars } from "./prompt-sample.js";

const COMPOSER = "11111111-1111-4111-8111-111111111111";

function snap(usedTokens = 1200) {
  return {
    ts: "2026-10-02T17:00:00.000Z",
    lastUpdatedAt: 1,
    percent: 12,
    usedTokens,
    limitTokens: 200000,
    summarizedTokens: 0,
    conversationTokens: 400,
    budget: {
      systemPrompts: 100,
      toolDefinitions: 200,
      rules: 50,
      skills: 0,
      mcpDynamicTools: 0,
      subagent: 0,
      summarizedConversation: 0,
      conversation: 400,
    },
  };
}

test("selectPromptBars keeps prompt samples only, latest 20", () => {
  const points = [];
  for (let i = 0; i < 25; i++) {
    points.push({ trigger: "user_prompt", generationId: `g${i}`, usedTokens: i });
  }
  points.push({ trigger: "poll", generationId: "poll-1", usedTokens: 99 });
  const bars = selectPromptBars(points);
  assert.equal(bars.length, 20);
  assert.equal(bars[0].generationId, "g5");
  assert.equal(bars[19].generationId, "g24");
  assert.equal(bars.some((b) => b.trigger === "poll"), false);
});

test("recordPromptSample appends one prompt row and skips the same generation", () => {
  const stored = [];
  const deps = {
    readHistory: () => stored.slice(),
    appendSample: (_id, sample) => stored.push(sample),
    sampleContext: () => snap(),
    detectEvent: () => null,
    seen: new Set(),
  };

  const first = recordPromptSample(COMPOSER, "gen-1", { model: "grok-4.7" }, deps);
  const second = recordPromptSample(COMPOSER, "gen-1", {}, deps);

  assert.equal(first.recorded, true);
  assert.equal(second.recorded, false);
  assert.equal(second.reason, "duplicate");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].trigger, "user_prompt");
  assert.equal(stored[0].generationId, "gen-1");
  assert.equal(stored[0].model, "grok-4.7");
  assert.equal(stored[0].budget.conversation, 400);
  assert.equal(stored[0].usedTokens, 1200);
});

test("recordPromptSample ignores invalid ids and a missing snapshot", () => {
  let samples = 0;
  let appends = 0;
  const deps = {
    readHistory: () => [],
    appendSample: () => {
      appends += 1;
    },
    sampleContext: () => {
      samples += 1;
      return null;
    },
    detectEvent: () => null,
    seen: new Set(),
  };

  const bad = recordPromptSample("not-a-uuid", "gen-1", {}, deps);
  const empty = recordPromptSample(COMPOSER, "gen-2", {}, deps);

  assert.equal(bad.recorded, false);
  assert.equal(bad.reason, "invalid");
  assert.equal(empty.recorded, false);
  assert.equal(empty.reason, "no_snapshot");
  assert.equal(samples, 1);
  assert.equal(appends, 0);
});

test("prompt ping responds 201 before reading composer state", async () => {
  const order = [];
  const deps = {
    readHistory: () => [],
    appendSample: () => {},
    sampleContext: () => {
      order.push("sample");
      return snap();
    },
    detectEvent: () => null,
    seen: new Set(),
    onResponded: (status) => {
      order.push(`responded:${status}`);
    },
  };

  const server = http.createServer((req, res) => {
    handlePromptPing(req, res, deps);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/prompt-ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: COMPOSER, generationId: "gen-9" }),
    });
    assert.equal(res.status, 201);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(order, ["responded:201", "sample"]);
  } finally {
    server.close();
  }
});
