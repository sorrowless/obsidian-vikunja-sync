# Obsidian Vikunja Sync

Bidirectional sync between Obsidian checklist tasks and [Vikunja](https://vikunja.io/) projects.

> **Status:** Phase 1 skeleton is in place (settings UI + placeholder **Sync now** command). Bidirectional sync is not implemented yet.

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

## Development

```bash
npm install
npm run dev      # watch build → main.js
npm run build    # typecheck + production bundle
npm test
./scripts/ci-check.sh
```

### Manual install in Obsidian

1. Build with `npm run build`.
2. Copy `main.js`, `manifest.json` (and `styles.css` if present) into  
   `Vault/.obsidian/plugins/obsidian-vikunja-sync/`.
3. Enable **Vikunja Sync** under Community plugins.

## Requirements

- Obsidian with community plugins enabled
- A Vikunja instance and API token (needed once sync is implemented)
- Optional: [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) for richer task workflows in the vault

## CI

[`scripts/ci-check.sh`](scripts/ci-check.sh) validates the docs layout, then runs `npm ci`, `npm run build`, and `npm test`.

GitHub Actions: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## License

Apache License 2.0. See [LICENSE](LICENSE).
