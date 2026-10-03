import type { VikunjaClient } from '../vikunja/client';
import type { VikunjaLabel, VikunjaTask } from '../vikunja/types';
import { labelTitleForStatus, type TaskStatus } from './status';

/**
 * Ensures the task carries exactly one status label for `status`.
 *
 * Because any non-ToDo/Done label is treated as In Progress when reading,
 * every existing label is a progress/status label and must be removed before
 * attaching the canonical ToDo / Done / In Progress label.
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

  const alreadyCorrect =
    current.length === 1 && current[0]?.id === desired.id;
  if (alreadyCorrect) {
    return current;
  }

  if (dryRun) {
    return [desired];
  }

  for (const label of current) {
    try {
      await client.removeLabelFromTask(task.id, label.id);
    } catch {
      // Label may already be gone.
    }
  }
  await client.addLabelToTask(task.id, desired.id);
  return [desired];
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
