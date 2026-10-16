import type { VikunjaClient } from '../vikunja/client';
import type { VikunjaLabel, VikunjaTask } from '../vikunja/types';
import { labelTitleForStatus, type TaskStatus } from './status';

/**
 * Ensures the task carries exactly one status label for `status`.
 *
 * Because any non-ToDo/Done label is treated as In Progress when reading,
 * every other label is removed. The desired label is added only when it is
 * not already present (Vikunja rejects duplicate label attachments).
 */
export async function applyStatusLabel(
  client: VikunjaClient,
  task: Pick<VikunjaTask, 'id' | 'labels'>,
  status: TaskStatus,
  labelCache: LabelCache,
  dryRun: boolean,
): Promise<VikunjaLabel[]> {
  const desiredTitle = labelTitleForStatus(status);
  const current = task.labels ?? [];
  const desired = await labelCache.ensure(desiredTitle, dryRun);

  const alreadyHasDesired = current.some((label) => label.id === desired.id);
  const extras = current.filter((label) => label.id !== desired.id);

  if (alreadyHasDesired && extras.length === 0) {
    return [desired];
  }

  if (dryRun) {
    return [desired];
  }

  for (const label of extras) {
    try {
      await client.removeLabelFromTask(task.id, label.id);
    } catch {
      // Label may already be gone.
    }
  }

  if (!alreadyHasDesired) {
    try {
      await client.addLabelToTask(task.id, desired.id);
    } catch (error) {
      // Update responses often omit labels, so `current` may be stale and the
      // desired label may already be on the task.
      if (!isLabelAlreadyExistsError(error)) {
        throw error;
      }
    }
  }

  return [desired];
}

function isLabelAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(message);
}

/** Cache of Vikunja labels for one sync run (avoids repeated list/create calls). */
export class LabelCache {
  private byTitle = new Map<string, VikunjaLabel>();
  private loaded = false;

  constructor(private readonly client: VikunjaClient) {}

  async ensure(title: string, dryRun: boolean): Promise<VikunjaLabel> {
    await this.load(dryRun);
    const key = title.trim().toLowerCase();
    const existing = this.byTitle.get(key);
    if (existing) {
      return existing;
    }
    if (dryRun) {
      const fake: VikunjaLabel = { id: -Math.abs(hashTitle(title)), title };
      this.byTitle.set(key, fake);
      return fake;
    }
    const created = await this.client.createLabel(title);
    this.byTitle.set(created.title.trim().toLowerCase(), created);
    return created;
  }

  private async load(dryRun: boolean): Promise<void> {
    if (this.loaded) {
      return;
    }
    if (dryRun) {
      this.loaded = true;
      return;
    }
    const labels = await this.client.listLabels();
    for (const label of labels) {
      this.byTitle.set(label.title.trim().toLowerCase(), label);
    }
    this.loaded = true;
  }
}

function hashTitle(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return hash === 0 ? 1 : hash;
}
