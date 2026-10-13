/**
 * Reconstitute a complete, unique in-memory ordering after loading a partial
 * sequential-entry draft. Only the selected prefix is saved to the database;
 * the remaining eligible works must stay available as choices on reload.
 *
 * In the actual-order editor, `draft` can also contain surprise works that
 * were not in the frozen list. Keep those user-selected additions instead of
 * silently deleting them when loading the draft.
 */
export function restoreDraftOrder<T extends string>(
  eligible: readonly T[],
  draft: readonly T[],
  excluded: readonly T[] = [],
): T[] {
  const absent = new Set(excluded);
  const seen = new Set<T>();
  const result: T[] = [];
  for (const id of [...draft, ...eligible]) {
    if (absent.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** A sequential draft is an ordered prefix, not the full on-screen list. */
export function selectedDraftPrefix<T>(order: readonly T[], count: number): T[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > order.length) {
    throw new Error('invalid sequential draft length');
  }
  return order.slice(0, count);
}
