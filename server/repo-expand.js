/** Toggle a repository row in the sidebar. Returns the same set. */
export function toggleRepoExpanded(expandedIds, repoId) {
  if (expandedIds.has(repoId)) expandedIds.delete(repoId);
  else expandedIds.add(repoId);
  return expandedIds;
}
