import { describe, expect, it, vi } from 'vitest';
import type { VikunjaClient } from '../vikunja/client';
import { applyStatusLabel, LabelCache } from './labels';

describe('applyStatusLabel', () => {
  it('removes non-canonical status labels like review when setting Done', async () => {
    const removeLabelFromTask = vi.fn().mockResolvedValue(undefined);
    const addLabelToTask = vi.fn().mockResolvedValue(undefined);
    const client = {
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
        { id: 200, title: 'review' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask,
      removeLabelFromTask,
    } as unknown as VikunjaClient;

    const labels = await applyStatusLabel(
      client,
      {
        id: 5,
        labels: [{ id: 200, title: 'review' }],
      },
      'done',
      new LabelCache(client),
      false,
    );

    expect(removeLabelFromTask).toHaveBeenCalledWith(5, 200);
    expect(addLabelToTask).toHaveBeenCalledWith(5, 102);
    expect(labels).toEqual([{ id: 102, title: 'Done' }]);
  });

  it('replaces Done+review with a single Done label', async () => {
    const removeLabelFromTask = vi.fn().mockResolvedValue(undefined);
    const addLabelToTask = vi.fn().mockResolvedValue(undefined);
    const client = {
      listLabels: vi.fn().mockResolvedValue([
        { id: 102, title: 'Done' },
        { id: 200, title: 'review' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask,
      removeLabelFromTask,
    } as unknown as VikunjaClient;

    const labels = await applyStatusLabel(
      client,
      {
        id: 9,
        labels: [
          { id: 200, title: 'review' },
          { id: 102, title: 'Done' },
        ],
      },
      'done',
      new LabelCache(client),
      false,
    );

    expect(removeLabelFromTask).toHaveBeenCalledWith(9, 200);
    expect(removeLabelFromTask).toHaveBeenCalledWith(9, 102);
    expect(addLabelToTask).toHaveBeenCalledWith(9, 102);
    expect(labels).toEqual([{ id: 102, title: 'Done' }]);
  });
});
