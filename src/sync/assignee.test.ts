import { describe, expect, it, vi } from 'vitest';
import type { VikunjaClient } from '../vikunja/client';
import type { AssigneeMapping } from '../settings';
import { reconcileAssignee } from './assignee';

const mappings: AssigneeMapping[] = [
  { vikunjaUserId: 3, label: 'Alice', obsidianTag: 'alice' },
  { vikunjaUserId: 7, label: 'Bob', obsidianTag: 'bob' },
];

function clientStub(overrides: Record<string, unknown> = {}): VikunjaClient {
  return {
    addAssignee: vi.fn().mockResolvedValue(undefined),
    removeAssignee: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as VikunjaClient;
}

describe('reconcileAssignee', () => {
  it('pulls Obsidian tag when Vikunja has a mapped assignee', async () => {
    const result = await reconcileAssignee({
      client: clientStub(),
      taskTitle: 'Task',
      taskId: 1,
      localStatus: 'todo',
      remoteStatus: 'todo',
      localTags: ['focus'],
      remoteAssignees: [{ id: 3, username: 'alice' }],
      mappings,
      dryRun: false,
    });

    expect(result.tags).toEqual(['focus', 'alice']);
    expect(result.actions).toEqual([
      expect.objectContaining({
        kind: 'assignee-set-obsidian',
        detail: expect.stringContaining('#alice'),
      }),
    ]);
  });

  it('pushes Vikunja assignee when Obsidian has a mapped tag', async () => {
    const addAssignee = vi.fn().mockResolvedValue(undefined);
    const removeAssignee = vi.fn().mockResolvedValue(undefined);
    const result = await reconcileAssignee({
      client: clientStub({ addAssignee, removeAssignee }),
      taskTitle: 'Task',
      taskId: 9,
      localStatus: 'todo',
      remoteStatus: 'todo',
      localTags: ['alice', 'focus'],
      remoteAssignees: [],
      mappings,
      dryRun: false,
    });

    expect(result.tags).toBeNull();
    expect(addAssignee).toHaveBeenCalledWith(9, 3);
    expect(result.actions[0]?.kind).toBe('assignee-set-vikunja');
  });

  it('lets Obsidian win when mapped assignees differ', async () => {
    const addAssignee = vi.fn().mockResolvedValue(undefined);
    const removeAssignee = vi.fn().mockResolvedValue(undefined);
    const result = await reconcileAssignee({
      client: clientStub({ addAssignee, removeAssignee }),
      taskTitle: 'Task',
      taskId: 9,
      localStatus: 'in_progress',
      remoteStatus: 'todo',
      localTags: ['alice'],
      remoteAssignees: [{ id: 7, username: 'bob' }],
      mappings,
      dryRun: false,
    });

    expect(removeAssignee).toHaveBeenCalledWith(9, 7);
    expect(addAssignee).toHaveBeenCalledWith(9, 3);
    expect(result.assigneeTag).toBe('alice');
  });

  it('skips when both sides are done', async () => {
    const addAssignee = vi.fn();
    const result = await reconcileAssignee({
      client: clientStub({ addAssignee }),
      taskTitle: 'Task',
      taskId: 9,
      localStatus: 'done',
      remoteStatus: 'done',
      localTags: ['alice'],
      remoteAssignees: [{ id: 7, username: 'bob' }],
      mappings,
      dryRun: false,
    });

    expect(result.actions).toEqual([]);
    expect(result.tags).toBeNull();
    expect(addAssignee).not.toHaveBeenCalled();
  });

  it('no-ops for unmapped remote assignees and unmapped local tags', async () => {
    const addAssignee = vi.fn();
    const result = await reconcileAssignee({
      client: clientStub({ addAssignee }),
      taskTitle: 'Task',
      taskId: 9,
      localStatus: 'todo',
      remoteStatus: 'todo',
      localTags: ['focus'],
      remoteAssignees: [{ id: 99, username: 'carol' }],
      mappings,
      dryRun: false,
    });

    expect(result.actions).toEqual([]);
    expect(result.tags).toBeNull();
    expect(addAssignee).not.toHaveBeenCalled();
  });

  it('records dry-run actions without calling the API', async () => {
    const addAssignee = vi.fn();
    const result = await reconcileAssignee({
      client: clientStub({ addAssignee }),
      taskTitle: 'Task',
      taskId: 9,
      localStatus: 'todo',
      remoteStatus: 'todo',
      localTags: ['alice'],
      remoteAssignees: [],
      mappings,
      dryRun: true,
    });

    expect(result.actions[0]?.kind).toBe('assignee-set-vikunja');
    expect(addAssignee).not.toHaveBeenCalled();
  });
});
