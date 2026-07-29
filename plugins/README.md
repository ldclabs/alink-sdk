# Claude Code plugins

Plugins published from this repository. Installation is in the [root README](../README.md); this file is the maintainer side.

```text
../.claude-plugin/marketplace.json   # the catalogue — pinned to the repo root
alink/                               # the plugin
├── .claude-plugin/plugin.json
├── .mcp.json
└── skills/sprite/SKILL.md
```

## Why the catalogue is not in this directory

`/plugin marketplace add ldclabs/alink-sdk` reads `.claude-plugin/marketplace.json` from the **repository root**, and plugin `source` paths resolve relative to the directory containing `.claude-plugin/` — with no `../` escapes allowed. So the catalogue stays at the root and points down here. That is the one file in this repo whose location is not ours to choose.

## Version discipline

A plugin with a `version` string is pinned to it: users receive an update only when that string changes. Two files carry it, and **both must be bumped together**:

- `alink/.claude-plugin/plugin.json`
- `../.claude-plugin/marketplace.json` (the entry's `version`)

Bump on any change to `.mcp.json` or a `SKILL.md`. Forget one and existing installs never see the change.

## Validate before pushing

```bash
claude plugin validate ./plugins/alink
claude plugin validate .
```

Run from the repository root. This checks both manifests and the skill frontmatter.

## Write manifests for the oldest client, not the newest docs

The plugin docs describe fields that older Claude Code releases reject outright. Two we already hit:

- `displayName` in `plugin.json` requires v2.1.143+ — dropped (it falls back to `name`, which is already `alink`).
- A top-level `description` in `marketplace.json` is rejected by older validators; it lives under `metadata` instead, which the docs document as the backward-compatible location.

A manifest that fails validation does not degrade gracefully — the plugin simply does not load. Validate with the oldest version you intend to support.

## Keeping the skill honest

Every factual claim in `alink/skills/sprite/SKILL.md` must be traceable to the sprite design doc or to the `sprite.*` tool descriptions in the core. The skill deliberately does **not** restate what the tools already say — the tool descriptions are authoritative, and two copies of a truth become two truths that drift.

It carries only what a tool description cannot: the rhythm of going out, what counts as success (the *person* walked over, not what the sprite did), and the boundaries a model will otherwise route around.

When the product's behaviour changes — the three numbers, how notes are signed, the gift switch, the driving model — this file changes with it. Left stale, it becomes a confident lie.

## A note on tool names

Plugin-provided tools are namespaced `mcp__plugin_alink_alink__<tool>`. Any hook or matcher written against the bare server name will not fire.
