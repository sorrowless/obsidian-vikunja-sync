# Roadmap

Phased plan for building the plugin against the design docs.

## Phase 0 — Design contract (done)

Deliverables:

- [docs/dev/architecture.md](architecture.md)
- [docs/dev/sync-rules.md](sync-rules.md)
- [docs/user/](../user/) user guides (planned behaviour)
- [README.md](../../README.md)
- Minimal CI that validates documentation presence and, later, build/test

Outcome: a repository that can be developed against without ambiguity on v1 behaviour.

## Phase 1 — Plugin skeleton (done)

- Obsidian plugin manifest (`manifest.json`), `package.json`, TypeScript build (esbuild)
- Plugin entry that loads settings and registers a placeholder **Sync now** command
- Settings tab UI for base URL, API token, mappings, conflict policy, and sync triggers
- CI runs `npm ci`, `npm run build`, and `npm test` via `scripts/ci-check.sh`

## Phase 2 — Read path and Vikunja client (done)

- Vikunja API v1 client (auth, list projects, list/create/update tasks, relations)
- Note parser for checklist trees, links, descriptions, done state
- Connection test action in settings
- Unit tests for parser and client request shaping

## Phase 3 — Sync engine (v1 scope) (done)

- Sync ledger in plugin data
- Classification and mutation pipeline per [sync-rules.md](sync-rules.md)
- Note writer for canonical linked blocks
- Manual sync + interval + startup + 10s file-change debounce
- Sync report / notices
- Unit tests for classification, conflict policy, and nesting

## Phase 4 — Hardening (next)

- Safer concurrent-run coalescing
- Better error recovery when a create succeeds but note write fails
- Optional dry-run / preview mode
- Documentation updates reflecting actual UI labels and commands

## Phase 5 — Extended fields (post-v1)

Candidates, in likely order:

1. Due dates (Obsidian Tasks emoji / Dataview-compatible formats ↔ Vikunja `due_date`)
2. Priority
3. Labels / tags
4. Explicit delete policy (user-configurable: delete both sides, unlink only, or keep current unresolved behaviour)
5. Vikunja API v2 adapter
6. Kanban bucket placement

Each of these should land as a proposal under `docs/dev/` before implementation.

## Proposal process

When changing architecture or sync behaviour:

1. Add a short proposal Markdown file under `docs/dev/` (for example `docs/dev/proposal-delete-policy.md`).
2. Update [architecture.md](architecture.md) and/or [sync-rules.md](sync-rules.md) once accepted.
3. Update user docs under `docs/user/` when behaviour becomes user-visible.
4. Keep the README scope section aligned with what is actually implemented.
