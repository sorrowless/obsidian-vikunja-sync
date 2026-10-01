# Task Format

> **Status:** This page describes the Markdown shape the plugin reads and writes for synced tasks.

Tasks live in ordinary Markdown notes as checklist items, compatible with Obsidian Tasks.

## Basic task

```markdown
- [ ] Buy milk
```

After the first sync that creates the task in Vikunja, the line becomes a link:

```markdown
- [ ] [Buy milk](https://vikunja.example/tasks/42)
```

The link text is the title. The URL points at the Vikunja task page.

## Description

Description lines are indented bullets **without** checkboxes, directly under the task:

```markdown
- [ ] [Write release notes](https://vikunja.example/tasks/7)
    - Mention breaking changes
    - Link to the changelog
```

Those bullets sync to the Vikunja task description (joined with newlines when sent to Vikunja).

## Nested subtasks

Indented checklist items are child tasks:

```markdown
- [ ] [Ship plugin](https://vikunja.example/tasks/10)
    - Outline README
    - [ ] [Write docs](https://vikunja.example/tasks/11)
        - Cover settings
    - [ ] [Add CI](https://vikunja.example/tasks/12)
```

In this example:

- `Outline README` is description text for task `10`.
- `Write docs` and `Add CI` are subtasks of task `10`.

After a rewrite, description bullets are ordered before child tasks.

## Done state

| Checkbox | Meaning |
| --- | --- |
| `[ ]` | Not done |
| `[x]` or `[X]` | Done |

Other checkbox characters are left alone and are not treated as done-state sync.

## List markers and indentation

- Existing tasks may use `-`, `*`, or numbered list markers; the plugin preserves the marker when rewriting a block.
- New blocks created by sync use `-` and four spaces per nesting level.

## What to avoid

- Putting important sync metadata only in frontmatter; identity is the Vikunja URL in the task line.
- Mixing multiple Vikunja projects’ tasks in one mapped note; each mapped note belongs to one project.
- Expecting plain indented bullets (no checkbox) to become Vikunja subtasks — they are description lines.
