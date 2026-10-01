# Settings

> **Status:** Settings fields and **Test connection** are available. Automatic sync triggers and conflict policy are used by the sync engine.

## Connection

| Setting | Description |
| --- | --- |
| Vikunja base URL | Root URL of your instance, without a trailing `/api` path. Example: `https://vikunja.example` |
| API token | Bearer token from Vikunja → Settings → API Tokens |

A **Test connection** button verifies that the saved URL and token can list projects.

## Note ↔ project mappings

Each mapping pairs:

- An Obsidian note path inside your vault
- A Vikunja **project** id

One note maps to one project. Tasks in that note sync with that project only.

In Vikunja, a board is a view of a project. Sync targets the project’s tasks, not a specific Kanban column.

## Conflict policy

When the same linked task changed both in Obsidian and in Vikunja since the last successful sync:

| Option | Behaviour |
| --- | --- |
| Prefer Obsidian (default) | Push Obsidian title, description, done state, and nesting to Vikunja |
| Prefer Vikunja | Pull Vikunja fields into the note |

## Sync triggers

These options are independent. The manual **Sync now** command is always available.

| Setting | Description |
| --- | --- |
| Sync on startup | Run once after Obsidian finishes loading the plugin |
| Sync on interval | Run periodically |
| Interval value | Number ≥ 1 |
| Interval unit | Minutes or hours |
| Sync on file change | After you edit a mapped note, wait 10 seconds from the last change, then sync that mapping |
| Dry-run by default | When enabled, **Sync now** / ribbon only preview. Automatic triggers still perform a real sync. |

Minimum interval is one minute.

Commands:

- **Sync now** — run sync (or dry-run if the setting above is on)
- **Preview sync (dry run)** — always preview without writing
