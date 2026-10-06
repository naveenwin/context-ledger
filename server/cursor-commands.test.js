import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  detectChatCommands,
  detectCursorUiCommands,
  detectGlobalSlashCommands,
  listGlobalSlashCommandSlugs,
  mergeCommandCountLists,
} from "./cursor-commands.js";

test("listGlobalSlashCommandSlugs reads ~/.cursor/commands markdown files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cl-cmd-"));
  fs.writeFileSync(path.join(dir, "code-review.md"), "# Review\n");
  fs.writeFileSync(path.join(dir, "notes.txt"), "skip");
  assert.deepEqual(listGlobalSlashCommandSlugs(dir), ["code-review"]);
  fs.rmSync(dir, { recursive: true });
});

test("detectGlobalSlashCommands matches leading slash for catalog slugs only", () => {
  const slugs = ["code-review", "ship-it"];
  assert.deepEqual(detectGlobalSlashCommands("/code-review please", slugs), [
    "/code-review",
  ]);
  assert.deepEqual(
    detectGlobalSlashCommands("/Users/naveen/foo", slugs),
    []
  );
});

test("detectGlobalSlashCommands matches global command path references", () => {
  const slugs = ["code-review"];
  assert.deepEqual(
    detectGlobalSlashCommands("See ~/.cursor/commands/code-review.md", slugs),
    ["/code-review"]
  );
});

test("detectCursorUiCommands recognizes diff-tab commit-and-push", () => {
  const cmds = detectCursorUiCommands(
    "Execute the selected diff-tab commit-and-push action."
  );
  assert.deepEqual(cmds, ["Commit & push (diff tab)"]);
});

test("detectChatCommands includes slash and UI signals from separate prompts", () => {
  assert.deepEqual(detectChatCommands("/ship-it", ["ship-it"]), ["/ship-it"]);
  assert.deepEqual(
    detectChatCommands(
      "Execute the selected diff-tab commit-and-push action.",
      ["ship-it"]
    ),
    ["Commit & push (diff tab)"]
  );
});

test("mergeCommandCountLists sums counts by label", () => {
  const merged = mergeCommandCountLists(
    [{ name: "/code-review", count: 2 }],
    [{ name: "/code-review", count: 1 }, { name: "Commit & push (diff tab)", count: 1 }]
  );
  assert.deepEqual(merged, [
    { name: "/code-review", count: 3 },
    { name: "Commit & push (diff tab)", count: 1 },
  ]);
});
