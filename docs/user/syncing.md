# Syncing

> **Status:** The plugin is not implemented yet. This page describes how sync is planned to behave.

## Overview

For each mapped note, the plugin will:

1. Read checklist tasks from the note
2. Fetch tasks from the mapped Vikunja project
3. Compare both sides to a private sync ledger (stored in plugin data, not in the note)
4. Create, update, or report issues according to the rules below
5. Rewrite linked task lines into the [canonical format](task-format.md)

## Create rules

**Obsidian only (new, unlinked task)**  
Create a Vikunja task, then rewrite the note line as a link to that task.

**Vikunja only (never synced before)**  
Append a linked task block to the note (under its parent when the parent already exists).

## Update rules

**Changed only in Obsidian**  
Update title, description, done state, and parent/child relation in Vikunja.

**Changed only in Vikunja**  
Update the corresponding lines in the Obsidian note.

**Changed on both sides**  
Apply your [conflict policy](settings.md#conflict-policy).

## Done state and nesting

- Checking or unchecking `[ ]` / `[x]` syncs with Vikunja’s done flag.
- Indenting a checklist item under another checklist item makes it a Vikunja subtask.
- Indented bullets without checkboxes are description text, not subtasks.

## Deletions (v1)

If a task was synced before and then disappears on only one side, the plugin will **not**:

- delete it on the other side, or
- recreate the missing copy.

The remaining side is left alone, and the sync report lists the case as unresolved. Automatic delete policies may be added later.

## When sync runs

- **Manual:** command palette → sync now (exact command name TBD)
- **Startup:** optional
- **Interval:** optional, at least every 1 minute
- **After editing a mapped file:** optional, 10 seconds after the last change to that file

Only one sync runs at a time; overlapping triggers wait for a single follow-up run.

## After a sync

You should see:

- New or updated Vikunja links in the mapped note
- Matching tasks in the Vikunja project
- A short notice or log summary (created / updated / unresolved / errors)

If something looks wrong, check the base URL, token permissions, and that the note is mapped to the intended project.
