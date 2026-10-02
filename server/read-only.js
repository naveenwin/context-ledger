import fs from "node:fs";

/**
 * Read Cursor local files without writing or taking locks that block the app.
 * JSONL transcripts: read-only file descriptors only.
 * Future SQLite (store.db): open with mode=ro — see openSqliteReadOnlyUri().
 */
export function readUtf8File(filePath) {
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY);
  try {
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

export function statReadOnly(filePath) {
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY);
  try {
    return fs.fstatSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** For better-sqlite3 / node-sqlite when we add store.db (phase B). */
export function openSqliteReadOnlyUri(absolutePath) {
  const normalized = absolutePath.replace(/\\/g, "/");
  return `file:${normalized}?mode=ro&immutable=1`;
}
