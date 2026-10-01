# Obsidian Vikunja Sync

Bidirectional sync between Obsidian checklist tasks and [Vikunja](https://vikunja.io/) projects.

> **Design phase.** This repository currently contains documentation, a README, and CI scaffolding. The Obsidian plugin itself is not implemented yet and cannot be installed.

## What it will do

Map selected Obsidian notes to Vikunja projects and keep tasks in sync in both directions:

- Create missing tasks on either side
- Update title, description, done state, and nested subtasks
- Resolve simultaneous edits with a Prefer Obsidian / Prefer Vikunja setting
- Run on demand, on a timer, at startup, or shortly after you edit a mapped note

Synced Obsidian lines use a Markdown link to the Vikunja task page:

```markdown
- [ ] [Task title](https://vikunja.example/tasks/123)
    - description line
    - [ ] [Child title](https://vikunja.example/tasks/456)
```

## v1 sync scope

| Included | Not yet |
| --- | --- |
| Title, description, done / not done | Due dates, priority, labels, assignees |
| Nested subtasks (parent/child) | Reminders, recurrence |
| Link identity via Vikunja task URL | Kanban bucket / column placement |
| Conflict preference setting | Automatic delete on either side |

## Documentation

**Users (planned behaviour)**

- [Getting started](docs/user/getting-started.md)
- [Task format](docs/user/task-format.md)
- [Settings](docs/user/settings.md)
- [Syncing](docs/user/syncing.md)

**Developers**

- [Architecture](docs/dev/architecture.md)
- [Sync rules](docs/dev/sync-rules.md)
- [Roadmap](docs/dev/roadmap.md)

## Requirements (when the plugin exists)

- Obsidian with community plugins enabled
- A Vikunja instance and API token
- Optional: [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) for richer task workflows in the vault

## Local CI check

Until `package.json` exists, CI only verifies that documentation layout is present:

```bash
./scripts/ci-check.sh
```

When the plugin is added, the same script will run `npm ci`, `npm run build`, and `npm test`.

GitHub Actions workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## License

License to be chosen when the first code release is prepared.
