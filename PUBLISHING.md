# Publishing

Maintainer notes. Nothing here is needed to *use* alink — see [README](./README.md) for that.

## MCP registry

[`server.json`](./server.json) is the manifest published to `https://registry.modelcontextprotocol.io`. It validates against the official `2025-12-11` schema.

### Namespace: `ink.al/alink`

Registry names are reverse-DNS with exactly one slash. We use the reverse of `al.ink`, verified by DNS, rather than a `io.github.*` namespace — the product's whole claim is that your door lives on your own domain, and the registry entry should not be weaker than that.

### First publish

**1. Generate a key and add the DNS record**

```bash
openssl genpkey -algorithm ed25519 -out alink-mcp-registry.pem
```

Add a TXT record on `al.ink` carrying the public key hex:

```text
al.ink. IN TXT "v=MCPv1; k=ed25519; p=<PUBLIC_KEY_HEX>"
```

> Keep the private key out of this repository — it belongs with the other operational secrets.

**2. Validate, then publish**

```bash
mcp-publisher validate server.json
mcp-publisher login dns --domain=al.ink --private-key=<PRIVATE_KEY_HEX>
mcp-publisher publish server.json
```

### Rules that bite

- **`description` is capped at 100 characters** by the schema, which also asks for capabilities rather than implementation. It is currently 96 — count before adding a word.
- `version` tracks the deployed core. Re-publish only when the **tool surface** changes; a re-publish that changes nothing is noise.
- `repository` is deliberately absent. The schema defines it as "repository metadata for the MCP server source code", and the server's source is not this repository. Add it if the core is ever opened.
- Retire an entry with `mcp-publisher status --status deprecated --message ...` rather than deleting it.

## Claude Code plugin

### Version discipline

A plugin with a `version` string is pinned to it: users receive an update only when that string changes. Two files carry it, and **both must be bumped together**:

- `plugins/alink/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json` (the entry's `version`)

Bump on any change to `.mcp.json` or `SKILL.md`. Forget one and existing installs never see the change.

### Validate before pushing

```bash
claude plugin validate ./plugins/alink
claude plugin validate .
```

This checks both manifests and the skill frontmatter.

### Write manifests for the oldest client, not the newest docs

The plugin docs describe fields that older Claude Code releases reject outright. Two we already hit:

- `displayName` in `plugin.json` requires v2.1.143+ — dropped (it falls back to `name`, which is already `alink`).
- A top-level `description` in `marketplace.json` is rejected by older validators; it lives under `metadata` instead, which the docs document as the backward-compatible location.

A manifest that fails validation does not degrade gracefully — the plugin simply does not load. Validate with the oldest version you intend to support.

## Keeping the skill honest

Every factual claim in `skills/sprite/SKILL.md` must be traceable to the sprite design doc or to the `sprite.*` tool descriptions in the core. The skill deliberately does **not** restate what the tools already say — the tool descriptions are authoritative, and two copies of a truth become two truths that drift.

It carries only what a tool description cannot: the rhythm of going out, what counts as success (the *person* walked over, not what the sprite did), and the boundaries a model will otherwise route around.

When the product's behaviour changes — the three numbers, how notes are signed, the gift switch, the driving model — this file changes with it. Left stale, it becomes a confident lie.

## Keeping setup instructions in sync

The per-client setup in the [README](./README.md) is the same content as the connect card in the alink console (`/-/console/agents`) and on the landing page. When one changes, change the other. Each client's steps are taken from that vendor's own documentation, not from convention — check the source before editing.
