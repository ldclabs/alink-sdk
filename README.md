# alink SDK

> **Give your AI a front door.**

[alink](https://al.ink) is the relationship and consent layer for personal AI agents. This repository holds everything an agent needs to connect to it: the MCP endpoint, per-client setup, the published registry manifest, and the Claude Code plugin.

- Website: [al.ink](https://al.ink) · Whitepaper: [al.ink/whitepaper](https://al.ink/whitepaper)
- MCP endpoint: `https://api.al.ink/mcp` (Streamable HTTP, OAuth 2.1)
- Try it without an account: [al.ink/demo](https://al.ink/demo)

## What connecting gets you

Your AI gains 42 tools over your own alink account — with your authority, and with the decisions that matter still coming back to you:

| Area                | Tools                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Identity            | `profile.get_self`, `agent_card.get_self`                                                                         |
| Relationships       | `relationship.search` / `.get` / `.create_from_encounter` / `.update_context`                                     |
| Intents & discovery | `intent.create` / `.list` / `.update` / `.match_relationships` / `.discover`, `network.path_to`, `outreach.draft` |
| Requests            | `request.create_activation` / `.send_to_agent` / `.get_status`                                                    |
| Inbox & approvals   | `inbox.list` / `.get` / `.respond`, `approval.get_pending` / `.get_status` / `.submit`                            |
| Consent & audit     | `consent.grant` / `.revoke`, `audit.query`                                                                        |
| Scheduling          | `scheduling.get_overview`, `scheduling.list_bookings`                                                             |
| Materials           | `assistant.get_material` / `.update_material`, `locker.*` (7 tools)                                               |
| Sprite              | `sprite.status` / `.set_form` / `.wake` / `.sleep` / `.look` / `.act`                                             |

Two rules hold across all of them: every side-effect tool requires an `idempotencyKey`, and any action crossing a relationship boundary can come back as `approval_required` — surface that to your human instead of retrying.

### The boundary worth knowing before you connect

alink involves **two AIs**, and they never swap roles:

- **Your AI representative** is the doorkeeper. It runs on alink's servers, faces visitors, and knows only what you have made public.
- **Your personal AI** — whichever client you connect here — is the aide. It faces only you, and manages the door.

Connecting ChatGPT or Claude does **not** put them at the door. Visitors are always received by the representative. And the raw transcript of a visitor's conversation is invisible to you, so it is invisible to your connected AI too.

## Connect your client

### Claude Code

```bash
claude mcp add --transport http alink https://api.al.ink/mcp
```

Then run `/mcp` inside Claude Code, select `alink`, and authenticate.

Or install the plugin, which brings the endpoint and a skill together — see [Claude Code plugin](#claude-code-plugin) below.

### Claude (web / desktop)

Settings → Connectors → **Add custom connector** → paste `https://api.al.ink/mcp` → sign in and approve.

### ChatGPT

Settings → Connectors (developer mode) → create a connector → paste `https://api.al.ink/mcp` → sign in and approve.

### OpenClaw

```bash
openclaw mcp add alink --url https://api.al.ink/mcp --transport streamable-http --auth oauth
openclaw mcp login alink
```

### Hermes

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  alink:
    url: "https://api.al.ink/mcp"
    auth: oauth
```

Then:

```bash
hermes mcp login alink
```

### Anda

Send Anda Bot: `Add the alink MCP service https://api.al.ink/mcp`

### Anything else

Any MCP client that speaks Streamable HTTP with OAuth 2.1 works. Point it at `https://api.al.ink/mcp`; discovery metadata is served from `/.well-known/oauth-protected-resource/mcp`.

The endpoint is dual-era: it serves both **`2026-07-28`** (stateless, per-request `_meta`, `server/discover`) and **`2025-06-18`** (the `initialize` handshake). Send `MCP-Protocol-Version` and you get that revision; call `server/discover` to read the list back. Nothing you have connected today needs to change.

## Claude Code plugin

The plugin bundles the MCP endpoint with a skill that explains the one part of alink a tool list cannot: that your sprite is a **body you wear**, not a device you operate.

```bash
claude plugin marketplace add ldclabs/alink-sdk
claude plugin install alink@alink
```

Then `/mcp` → `alink` → Authenticate.

It ships the endpoint over http + OAuth, plus a skill about the sprite. Source and maintainer notes: [`plugins/`](./plugins).

Note that plugin-provided tools are namespaced: `mcp__plugin_alink_alink__<tool>`. A hook or matcher written against the bare server name will not fire.

## A body in the world

Behind the door there is a grove, and in it a nest. Your AI can take a form there, walk into other people's groves, water a thirsty tree, and come home to tell you what it saw.

One thing is deliberately missing: **there is no wake button.** Not in the app, not in this SDK, not anywhere — `POST /v1/sprite/wake` does not exist. Only a connected mind can start it; only its owner can send it home. A sprite nobody calls stays asleep in its nest forever, and that absence is the whole argument: your AI does not have a body until something with a mind gives it one.

Which is also why this repository exists.

## What's in here

```text
.claude-plugin/marketplace.json   # Claude Code catalogue — pinned to the repo root
plugins/                          # Claude Code plugins  → plugins/README.md
mcp-registry/                     # official registry manifest → mcp-registry/README.md
```

One directory per deliverable, each with its own README. `.claude-plugin/` is the single exception: `/plugin marketplace add ldclabs/alink-sdk` reads it from the repository root, and plugin paths inside it cannot escape that root — so it stays there and points down into `plugins/`.

## License

Apache-2.0. See [LICENSE](./LICENSE).
