/** Cursor project folder name under ~/.cursor/projects (slashes in paths become `-`). */
export function cursorProjectSlugFromPath(fsPath) {
  if (!fsPath) return null;
  const norm = String(fsPath).replace(/\\/g, "/").replace(/\/$/, "");
  return norm.replace(/^\//, "").replace(/\//g, "-");
}

/** Decode ~/.cursor/projects/Users-naveenkumar-D-foo-Bar → /Users/naveenkumar/D/foo/Bar */
export function decodeProjectSlug(slug) {
  if (!slug.startsWith("Users-")) {
    return { name: slug, path: null };
  }
  const parts = slug.split("-");
  if (parts[0] !== "Users" || parts.length < 3) {
    return { name: slug, path: null };
  }
  const fsPath = "/" + parts.join("/");
  const name = parts[parts.length - 1] || slug;
  return { name, path: fsPath };
}

export function repoIdFromKey(key) {
  return key
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}
