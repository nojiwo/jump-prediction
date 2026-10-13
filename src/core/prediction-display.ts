/**
 * Select the issue shown on the public prediction tab. An accepting issue takes
 * precedence; after its deadline the most recent closed issue remains visible
 * for the post-deadline comparison until the next issue opens.
 * Planned issues are never exposed through this selector.
 */
export type PredictionDisplayIssue = {
  code: string;
  release_at: string;
  cutoff_at: string;
  status: 'planned' | 'open' | 'closed';
};

export function pickPredictionDisplayIssue<T extends PredictionDisplayIssue>(issues: readonly T[]): T | null {
  const open = issues.filter(issue => issue.status === 'open')
    .sort((a, b) => b.release_at.localeCompare(a.release_at) || b.code.localeCompare(a.code));
  if (open.length) return open[0];
  const closed = issues.filter(issue => issue.status === 'closed')
    .sort((a, b) => b.release_at.localeCompare(a.release_at) || b.code.localeCompare(a.code));
  return closed[0] ?? null;
}
