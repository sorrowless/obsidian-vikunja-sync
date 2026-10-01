# Architecture

This document describes the architecture for the Obsidian ↔ Vikunja sync plugin. Phases 1–4 are implemented: settings, Vikunja client, note parser/writer, ledger, sync engine, triggers, and hardening (coalescing, pending-link recovery, dry-run).

## Goals

- Bidirectional sync of tasks between mapped Obsidian notes and Vikunja projects.
- Preserve Obsidian Tasks-compatible checklist syntax.
- Detect local vs remote changes without embedding sync metadata in note bodies.
- Support manual, interval, startup, and debounce-on-edit triggers.

## Non-goals (v1)

- Syncing due dates, priority, labels, assignees, reminders, recurrence, or Kanban buckets.
- Automatic deletion on either side when a previously synced task disappears.
- Mapping one note to multiple Vikunja projects, or one project to multiple notes.
- Using Vikunja API v2 (v1 only; v2 may be added later as an adapter).

## High-level components

```text
┌─────────────────────────────────────────────────────────────┐
│                     Obsidian Plugin                          │
│                                                              │
│  Settings UI ──► PluginSettings                               │
│       │                                                       │
│  Commands / Scheduler ──► SyncEngine                          │
│                              │                                │
│              ┌───────────────┼───────────────┐                │
│              ▼               ▼               ▼                │
│        NoteParser      VikunjaClient     SyncLedger           │
│        NoteWriter           │                 │               │
│              │              ▼                 │               │
│              │         Vikunja API v1         │               │
│              ▼                                ▼               │
│         Vault files                    Plugin data store      │
└─────────────────────────────────────────────────────────────┘
```

### Settings

Stores connection and behaviour configuration:

| Field | Purpose |
| --- | --- |
| `vikunjaBaseUrl` | Instance root URL, e.g. `https://vikunja.example` |
| `vikunjaApiToken` | Bearer token for API v1 |
| `mappings` | Array of `{ notePath, projectId }` |
| `conflictPolicy` | `prefer-obsidian` (default) or `prefer-vikunja` |
| `syncOnStartup` | Boolean |
| `syncIntervalEnabled` | Boolean |
| `syncIntervalValue` | Number ≥ 1 |
| `syncIntervalUnit` | `minutes` or `hours` |
| `syncOnFileChange` | Boolean; debounce is fixed at 10 seconds |

### Vikunja client

Thin HTTP client over Vikunja API v1 (`/api/v1`).

Required operations:

| Operation | Endpoint |
| --- | --- |
| List projects | `GET /projects` |
| List project tasks | `GET /projects/{id}/tasks` (with relation expansion as needed) |
| Get task | `GET /tasks/{id}` |
| Create task | `PUT /projects/{id}/tasks` |
| Update task | `POST /tasks/{id}` |
| Create relation | `PUT /tasks/{id}/relations` |
| Delete relation | `DELETE /tasks/{id}/relations/{otherTaskId}/{relationKind}` (if needed for parent changes) |

Authentication header: `Authorization: Bearer <token>`.

Task identity in notes uses the frontend URL pattern `{baseUrl}/tasks/{id}`.

### Note parser / writer

- **Parser**: walk mapped note lines, recognise checklist items (`-` / `*` / numbered markers + `[ ]` / `[x]` / `[X]`), build a tree from indentation, extract Vikunja links, treat non-checkbox indented bullets as description lines.
- **Writer**: rewrite synced blocks into the canonical shape while preserving existing list marker and indent width when a block already exists; for new blocks use `-` and four spaces.

Canonical block:

```markdown
- [ ] [Task title](https://vikunja.example/tasks/123)
    - description line
    - [ ] [Child title](https://vikunja.example/tasks/456)
        - child description
```

On rewrite, description lines come first, then child tasks.

### Sync ledger

Persisted in plugin data (not in notes). One entry per Vikunja task id that has been successfully synced for a mapping.

```ts
interface LedgerEntry {
  taskId: number;
  mappingKey: string; // stable key derived from notePath + projectId
  title: string;
  description: string;
  done: boolean;
  parentTaskId: number | null;
  contentHash: string; // hash of title + description + done + parent
  vikunjaUpdated: string; // ISO timestamp from Vikunja `updated`
  lastSyncedAt: string; // ISO timestamp of last successful sync write
}
```

The ledger is how the engine distinguishes:

- local-only change (note differs from ledger; Vikunja matches ledger),
- remote-only change (Vikunja differs from ledger; note matches ledger),
- conflict (both differ from ledger),
- unchanged (both match ledger).

### Sync engine

For each mapping:

1. Read and parse the note.
2. Fetch all tasks for the Vikunja project (including related subtasks).
3. Load ledger entries for that mapping.
4. Classify every local task and every remote task.
5. Apply actions (create remote, create local, push, pull, conflict policy, report unresolved removals).
6. Write the note once per mapping (if changed).
7. Persist the updated ledger.
8. Emit a sync report (notice / log).

See [sync-rules.md](sync-rules.md) for classification rules.

### Scheduler

Independent triggers:

- Manual command always available.
- Optional interval timer (minimum 1 minute).
- Optional run on Obsidian load.
- Optional vault `modify` listener for mapped files, debounced 10 seconds after the last change to that file.

Only one sync run may execute at a time; overlapping triggers queue or coalesce into a single follow-up run.

## Data flow

```text
Read mapped note ──┐
Read Vikunja tasks ┼──► Classify against ledger ──► Apply mutations ──► Save note + ledger
Load sync ledger ──┘
```

Classification outcomes:

| Outcome | Action |
| --- | --- |
| Local only (unlinked, never in ledger) | Create in Vikunja; rewrite note with link |
| Remote only (never in ledger) | Append linked task to note |
| Local changed | Update Vikunja |
| Remote changed | Update note |
| Both changed | Apply conflict policy |
| Previously synced, missing on one side | Report unresolved; do not delete or recreate |
| Unchanged | No-op |

## Mapping model

- One note ↔ one Vikunja **project**.
- A Vikunja board is a view of a project; tasks belong to the project. Settings store `projectId`.
- Kanban buckets are out of scope for v1.

## Nesting model

Obsidian nested checklist items map to Vikunja task relations:

- Child → parent: `relation_kind: "subtask"` (or the inverse `parenttask` depending on which task is the base of the `PUT`).
- All related tasks for a mapping stay in the same project.
- Plain indented bullets without checkboxes are description content, not child tasks.

## Conflict detection

For a paired task (linked in the note and present in Vikunja):

1. Compute local content hash from note title, description, done, parent.
2. Compare local hash to ledger `contentHash`.
3. Compare Vikunja `updated` (and/or remote content hash) to ledger.
4. If only local differs → push.
5. If only remote differs → pull.
6. If both differ → conflict policy.
7. If neither differs → skip.

## Error handling

- Network / auth failures abort the current mapping and report the error; other mappings may continue.
- Partial write failure within a mapping should leave the ledger unchanged for failed task ids so the next run can retry.
- The engine must not leave a newly created Vikunja task unlinked in the note if the create API call succeeded; rewrite the note before considering that create complete.

## Testing strategy (later)

- Unit tests for parser, writer, hash, and classification (no Obsidian or network).
- Integration tests against a mocked Vikunja HTTP layer.
- Manual vault fixture for end-to-end checks in Obsidian.
