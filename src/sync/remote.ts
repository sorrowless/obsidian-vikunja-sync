import type { VikunjaTask } from '../vikunja/types';

export interface RemoteTaskView {
  task: VikunjaTask;
  parentTaskId: number | null;
}

/**
 * Flatten project tasks and nested `related_tasks.subtask` into an id → view map.
 * Parent comes from an explicit parenttask relation or from the subtask walk.
 */
export function indexRemoteTasks(tasks: VikunjaTask[]): Map<number, RemoteTaskView> {
  const map = new Map<number, RemoteTaskView>();

  const upsert = (task: VikunjaTask, parentTaskId: number | null): void => {
    const existing = map.get(task.id);
    if (existing) {
      // Prefer a concrete parent when we discover one via subtask walk.
      if (existing.parentTaskId === null && parentTaskId !== null) {
        existing.parentTaskId = parentTaskId;
      }
      // Keep the richer task object when related_tasks are present.
      if (!existing.task.related_tasks && task.related_tasks) {
        existing.task = task;
      }
      return;
    }
    map.set(task.id, { task, parentTaskId });
  };

  const walk = (task: VikunjaTask, parentTaskId: number | null): void => {
    const parentFromRelation = task.related_tasks?.parenttask?.[0]?.id ?? parentTaskId;
    upsert(task, parentFromRelation);
    for (const child of task.related_tasks?.subtask ?? []) {
      walk(child, task.id);
    }
  };

  for (const task of tasks) {
    walk(task, task.related_tasks?.parenttask?.[0]?.id ?? null);
  }

  return map;
}
