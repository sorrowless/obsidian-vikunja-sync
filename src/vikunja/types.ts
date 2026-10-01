export interface VikunjaProject {
  id: number;
  title: string;
}

export interface VikunjaTask {
  id: number;
  title: string;
  description: string;
  done: boolean;
  project_id: number;
  updated: string;
  related_tasks?: Partial<Record<VikunjaRelationKind, VikunjaTask[]>>;
}

export type VikunjaRelationKind =
  | 'subtask'
  | 'parenttask'
  | 'related'
  | 'duplicateof'
  | 'duplicates'
  | 'blocking'
  | 'blocked'
  | 'precedes'
  | 'follows'
  | 'copiedfrom'
  | 'copiedto';

export interface CreateTaskInput {
  title: string;
  description?: string;
  done?: boolean;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  done?: boolean;
}

export interface CreateRelationInput {
  otherTaskId: number;
  relationKind: VikunjaRelationKind;
}

export class VikunjaApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'VikunjaApiError';
    this.status = status;
    this.body = body;
  }
}
