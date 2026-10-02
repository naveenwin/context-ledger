import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapSubagentRunStatus,
  mergeSubagentStatuses,
} from "./subagent-status.js";

describe("mapSubagentRunStatus", () => {
  it("maps Cursor composer values", () => {
    assert.equal(mapSubagentRunStatus("completed"), "success");
    assert.equal(mapSubagentRunStatus("aborted"), "aborted");
    assert.equal(mapSubagentRunStatus("error"), "failed");
    assert.equal(mapSubagentRunStatus("none"), "running");
    assert.equal(mapSubagentRunStatus(null), "running");
  });
});

describe("mergeSubagentStatuses", () => {
  it("matches transcript spawns to composer runs by heading", () => {
    const transcript = [
      { type: "generalPurpose", heading: "Update restriction processor tests" },
      { type: "generalPurpose", heading: "Update OneSupportService tests" },
    ];
    const runs = [
      {
        composerId: "a",
        name: "Update OneSupportService tests",
        type: "generalPurpose",
        status: "success",
        rawStatus: "completed",
        createdAt: 2,
      },
      {
        composerId: "b",
        name: "Update restriction processor tests",
        type: "generalPurpose",
        status: "aborted",
        rawStatus: "aborted",
        createdAt: 1,
      },
    ];
    const merged = mergeSubagentStatuses(transcript, runs);
    assert.equal(merged[0].heading, "Update restriction processor tests");
    assert.equal(merged[0].status, "aborted");
    assert.equal(merged[1].status, "success");
  });

  it("falls back to spawn order when headings differ", () => {
    const transcript = [{ type: "explore", heading: "Scan repo" }];
    const runs = [
      {
        composerId: "x",
        name: "Project file exploration",
        type: "explore",
        status: "success",
        rawStatus: "completed",
        createdAt: 1,
      },
    ];
    const merged = mergeSubagentStatuses(transcript, runs);
    assert.equal(merged[0].status, "success");
    assert.equal(merged[0].composerId, "x");
  });
});
