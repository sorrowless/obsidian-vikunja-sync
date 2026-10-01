# Getting Started

> **Status:** The plugin loads in Obsidian with settings and **Test connection**. Bidirectional sync is not implemented yet.

This plugin syncs checklist tasks between Obsidian notes and projects on a Vikunja instance (including self-hosted).

## Prerequisites

- Obsidian desktop (community plugins enabled)
- A Vikunja instance you can reach over HTTPS (or HTTP on a trusted local network)
- A Vikunja API token (Settings → API Tokens in Vikunja)
- Optional but recommended: the [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin, so checklists remain queryable in Obsidian

## Planned install steps

1. Install the plugin from Community Plugins (or manually from a release zip once releases exist).
2. Enable **Vikunja Sync** (final display name may match the repository name).
3. Open plugin settings and enter:
   - Vikunja base URL (for example `https://vikunja.example`)
   - API token
4. Map at least one Obsidian note path to one Vikunja project.
5. Choose a conflict policy (default: Prefer Obsidian).
6. Enable the sync triggers you want (startup, interval, file change). Manual sync remains available as a command.
7. Run **Sync now** once and confirm tasks appear with Vikunja links.

## What gets synced in the first version

- Task title
- Task description
- Done / not done
- Nested subtasks
- A Markdown link from the Obsidian task line to the Vikunja task page

Not synced yet: due dates, priority, labels, assignees, reminders, recurrence, or Kanban columns.

## Next reading

- [Task format](task-format.md)
- [Settings](settings.md)
- [Syncing](syncing.md)
