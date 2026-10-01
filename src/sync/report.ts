import type { MappingSyncResult, SyncRunResult } from './engine';

/** Flatten mapping errors into user-facing lines. */
export function collectSyncErrors(result: SyncRunResult): string[] {
  const lines: string[] = [];
  for (const mapping of result.mappings) {
    const label = mapping.notePath || `project ${mapping.projectId || '?'}`;
    for (const error of mapping.errors) {
      lines.push(`${label}: ${error}`);
    }
  }
  return lines;
}

/**
 * Short notice text: summary plus up to a few error details so the user
 * is not left with only “1 error”.
 */
export function formatSyncNotice(result: SyncRunResult, maxErrors = 3): string {
  const errors = collectSyncErrors(result);
  if (errors.length === 0) {
    return result.message;
  }

  const shown = errors.slice(0, maxErrors);
  const parts = [result.message, '', 'Errors:', ...shown.map((line) => `• ${line}`)];
  if (errors.length > maxErrors) {
    parts.push(`• …and ${errors.length - maxErrors} more (see sync report)`);
  }
  return parts.join('\n');
}

/** Full multi-line report for the modal / console. */
export function formatSyncReport(result: SyncRunResult): string {
  const lines: string[] = [result.message, ''];

  for (const mapping of result.mappings) {
    lines.push(formatMappingSection(mapping));
    lines.push('');
  }

  const errors = collectSyncErrors(result);
  if (errors.length > 0) {
    lines.push('Errors');
    lines.push('------');
    for (const error of errors) {
      lines.push(`• ${error}`);
    }
  }

  return lines.join('\n').trimEnd();
}

function formatMappingSection(mapping: MappingSyncResult): string {
  const c = mapping.counts;
  const header = mapping.notePath
    ? `${mapping.notePath} → project ${mapping.projectId}`
    : `project ${mapping.projectId}`;

  const bits = [
    `+${c.createdRemote} remote`,
    `+${c.createdLocal} local`,
    `${c.pushed} pushed`,
    `${c.pulled} pulled`,
    `${c.conflictsResolved} conflicts`,
    `${c.unchanged} unchanged`,
    `${c.unresolvedRemovals} unresolved`,
  ];
  if (c.recoveredPendingLinks > 0) {
    bits.push(`${c.recoveredPendingLinks} recovered`);
  }
  if (mapping.errors.length > 0) {
    bits.push(`${mapping.errors.length} error${mapping.errors.length === 1 ? '' : 's'}`);
  }

  return `${header}\n  ${bits.join(', ')}`;
}
