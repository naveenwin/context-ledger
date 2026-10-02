import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");
export const CURSOR_HOME = path.join(os.homedir(), ".cursor");
export const CURSOR_APP_SUPPORT = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Cursor"
);

export function cursorProjectsDir() {
  return path.join(CURSOR_HOME, "projects");
}

export function workspaceStorageDir() {
  return path.join(CURSOR_APP_SUPPORT, "User", "workspaceStorage");
}

export function aiTrackingDbPath() {
  return path.join(CURSOR_HOME, "ai-tracking", "ai-code-tracking.db");
}

export function pathExists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}
