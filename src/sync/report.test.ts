import { describe, expect, it } from 'vitest';
import type { SyncRunResult } from './engine';
import { collectSyncErrors, formatSyncNotice, formatSyncReport } from './report';

function sampleResult(overrides?: Partial<SyncRunResult>): SyncRunResult {
  return {
    dryRun: true,
    message: 'Vikunja Sync dry-run: 1 mapping, +0 remote, +0 local, 0 pushed, 0 pulled, 0 conflicts, 0 unresolved, 1 error',
    mappings: [
      {
        notePath: 'Tasks/Work.md',
        projectId: 3,
        counts: {
          createdRemote: 0,
          createdLocal: 0,
          pushed: 0,
          pulled: 0,
          conflictsResolved: 0,
          unchanged: 0,
          unresolvedRemovals: 0,
          recoveredPendingLinks: 0,
        },
        errors: ['Note not found: Tasks/Work.md'],
        unresolvedTaskIds: [],
        pendingLinks: [],
      },
    ],
    ...overrides,
  };
}

describe('sync report formatting', () => {
  it('includes the actual error text in the notice', () => {
    const notice = formatSyncNotice(sampleResult());
    expect(notice).toContain('1 error');
    expect(notice).toContain('Tasks/Work.md: Note not found: Tasks/Work.md');
  });

  it('collects errors with mapping labels', () => {
    expect(collectSyncErrors(sampleResult())).toEqual([
      'Tasks/Work.md: Note not found: Tasks/Work.md',
    ]);
  });

  it('builds a full report with mapping counts and errors', () => {
    const report = formatSyncReport(sampleResult());
    expect(report).toContain('Tasks/Work.md → project 3');
    expect(report).toContain('Errors');
    expect(report).toContain('Note not found: Tasks/Work.md');
  });
});
