# Sync Rules

Behavioral contract for bidirectional sync. The plugin implementation must follow these rules.

## Scope (v1)

Synced fields:

- Title
- Description
- Done state
- Parent / child nesting
- Vikunja task URL in the Obsidian task line
- Start / end times (`🛫` / `📅` after the link ↔ Vikunja `start_date` / `end_date`)

Not synced in v1:

- Due dates, priority, labels, assignees, reminders, recurrence
- Kanban buckets / board columns
- Automatic deletion

## Task identity

A task is linked when its Obsidian line contains a Markdown link (at the start of the checklist body) whose URL matches:

```text
{vikunjaBaseUrl}/tasks/{numericId}
```

Trailing slashes and query fragments are ignored when extracting the id. The link text is the Obsidian title. Optional start/end markers after the link do **not** break identity.

Unlinked checklist items are candidates for create-in-Vikunja.

## Canonical Markdown

After any successful sync write, a synced task block looks like:

```markdown
- [ ] [Task title](https://vikunja.example/tasks/123) 🛫 2026-10-02 10:00 📅 2026-10-02 11:00
    - description line one
    - description line two
    - [ ] [Child title](https://vikunja.example/tasks/456)
        - child description
```

Rules:

1. The primary line is a checklist item whose body starts with a link `[title](url)`, optionally followed by start/end date markers.
2. Start (`🛫`) and end (`📅`) times are written after the link; they are not part of the link text.
3. Description is represented as indented bullets **without** checkboxes.
4. Child tasks are indented checklist items (with checkboxes).
5. On rewrite, description lines come first, then child tasks.
6. Existing list marker (`-`, `*`, or numbered) and indent style are preserved for an existing block.
7. Newly created blocks use `-` and four spaces per indent level.
8. New Obsidian tasks created from Vikunja are appended at the end of the mapped note.

## Done state

| Obsidian | Vikunja |
| --- | --- |
| `[ ]` | `done: false` |
| `[x]` or `[X]` | `done: true` |

Any other checkbox character (for example `[/]`, `[-]`) is left unchanged and is **not** synced for that task’s done field. Title, description, and nesting still sync.

## Nesting

- Indentation of checklist items defines parent/child trees in the note.
- Nested checklist items become Vikunja `subtask` / `parenttask` relations in the same project.
- Changing indentation of an already-linked task updates the Vikunja relation.
- Description bullets must not be treated as children.

## Classification

For each mapping, build three sets:

1. **Local tasks** — checklist items in the note (tree).
2. **Remote tasks** — tasks in the Vikunja project.
3. **Ledger entries** — last successful sync snapshot for that mapping.

### Create remote (Obsidian → Vikunja)

Condition: local checklist item has no Vikunja link **and** is not already represented by a ledger entry.

Action:

1. Create a Vikunja task with title = local description text, description = joined description bullets, done = local checkbox, project = mapped project.
2. If the local item has a parent that is already linked (or was just created), create a `subtask` relation.
3. Rewrite the Obsidian line to the canonical linked form.
4. Write a ledger entry.

### Create local (Vikunja → Obsidian)

Condition: remote task exists in the project, has no matching linked line in the note, and has **no** ledger entry (never synced).

Action:

1. Append a canonical block to the end of the note (or under the parent block if the parent is already present).
2. Title and URL from Vikunja; description from Vikunja description (split into bullets by newlines).
3. Write a ledger entry.

Prefer placing a new child under its parent block when the parent already exists in the note. Top-level new tasks are appended at the end.

### Push (Obsidian wins for this change)

Condition: linked local task exists; remote exists; local content differs from ledger; remote matches ledger.

Action: update Vikunja title, description, done, and parent relation; update ledger.

### Pull (Vikunja wins for this change)

Condition: linked local task exists; remote exists; remote differs from ledger; local matches ledger.

Action: rewrite the Obsidian block from Vikunja; update ledger.

### Conflict

Condition: both local and remote differ from the ledger.

Action:

- If `conflictPolicy === prefer-obsidian`: same as Push.
- If `conflictPolicy === prefer-vikunja`: same as Pull.

Default policy: `prefer-obsidian`.

### Unchanged

Condition: local and remote both match the ledger.

Action: no-op.

### Unresolved removal

Condition: a ledger entry exists, but the task is missing on exactly one side (deleted in the note **or** deleted in Vikunja).

Action:

- Do **not** delete the remaining side.
- Do **not** recreate the missing side.
- Leave the remaining side as-is.
- Keep or mark the ledger entry as unresolved and include it in the sync report.

Brand-new unlinked note tasks and brand-new Vikunja tasks (never in the ledger) still follow the create rules above.

## Sync triggers

| Trigger | Behaviour |
| --- | --- |
| Manual | Always available via command |
| Interval | Optional; value ≥ 1; unit minutes or hours |
| Startup | Optional; run after plugin load when settings allow |
| File change | Optional; 10 seconds after the last modification of a mapped file |

Triggers are independent. Concurrent runs coalesce.

## Worked examples

### Example A — new Obsidian task

Before:

```markdown
- [ ] Buy milk
```

After sync:

```markdown
- [ ] [Buy milk](https://vikunja.example/tasks/42)
```

Vikunja has a new task titled `Buy milk`.

### Example B — new Vikunja task with description

Vikunja task `99`, title `Write docs`, description:

```text
Cover architecture
Cover sync rules
```

Appended to note:

```markdown
- [ ] [Write docs](https://vikunja.example/tasks/99)
    - Cover architecture
    - Cover sync rules
```

### Example C — nested child

Note:

```markdown
- [ ] [Parent](https://vikunja.example/tasks/1)
    - [ ] Child idea
```

After sync, child becomes a Vikunja subtask of task `1`, and the note becomes:

```markdown
- [ ] [Parent](https://vikunja.example/tasks/1)
    - [ ] [Child idea](https://vikunja.example/tasks/2)
```

### Example D — conflict with Prefer Obsidian

Ledger: title `A`, done false.  
Note: title `B`, done false.  
Vikunja: title `C`, done false.

Result with Prefer Obsidian: Vikunja title set to `B`; note kept as linked `B`.

### Example E — unresolved deletion

Ledger knows task `7`. Note still has the linked line. Vikunja no longer returns task `7`.

Result: note unchanged; sync report lists task `7` as unresolved removal; no recreate.

## Sync report

Each run should report at least:

- Mapping identity (note path, project id)
- Counts: created remote, created local, pushed, pulled, conflicts resolved, unchanged, unresolved removals
- Errors

Presentation can be an Obsidian Notice for short summaries and a more detailed log for debugging.
