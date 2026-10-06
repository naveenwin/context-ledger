import assert from "node:assert/strict";
import test from "node:test";
import { toggleRepoExpanded } from "./repo-expand.js";

test("toggleRepoExpanded collapses a project that is already open", () => {
  const expanded = new Set(["repo-a", "repo-b"]);
  toggleRepoExpanded(expanded, "repo-a");
  assert.equal(expanded.has("repo-a"), false);
  assert.equal(expanded.has("repo-b"), true);
});

test("toggleRepoExpanded opens a project that is closed", () => {
  const expanded = new Set(["repo-b"]);
  toggleRepoExpanded(expanded, "repo-a");
  assert.equal(expanded.has("repo-a"), true);
  assert.equal(expanded.has("repo-b"), true);
});
