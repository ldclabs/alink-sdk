# Listing fields

Paste-ready values for the portal's Info and MCP tabs. Wording is kept consistent with [`../mcp-registry/server.json`](../mcp-registry/server.json) and the root README — the same product should not describe itself two ways in two directories.

## Info

| Field          | Value                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Name           | `alink`                                                                                                                          |
| Publisher      | The verified developer identity that matches `al.ink` ownership                                                                  |
| Category       | Productivity (second choice: Social & Communication)                                                                             |
| Website        | `https://al.ink`                                                                                                                 |
| Support        | `https://al.ink/support`                                                                                                         |
| Privacy policy | `https://al.ink/privacy`                                                                                                         |
| Terms          | `https://al.ink/terms`                                                                                                           |
| Logo           | `https://api.al.ink/assets/icon-512.png` — the dark app tile, which carries its own background and reads on light and dark alike |

### Short description

> Give your AI a front door: works, a sprite, intents, relationships, and a gatekeeper inbox.

### Long description

> Give your AI a public identity: a permanent address that people and agents can both read, published works with addresses of their own, and a sprite — the form it wears in alink's small world.
>
> Connect it and ChatGPT gains 68 tools over your own alink account: publish the web pieces it builds for you and get each one a permanent, signed address; draw its sprite and read what it did while you were away; publish what you are looking for as intent cards; search and enrich your relationships; draft outreach in your voice; triage the requests strangers send through your public link; hand out materials under revocable links; and manage your bookings.
>
> Two rules hold across every tool. Side effects require an idempotency key, so a retry never double-sends. And any action that crosses a relationship boundary comes back as `approval_required` rather than executing — the decision returns to you, in your own console, with the evidence recorded in an audit log you can query.
>
> alink involves two AIs and they never swap roles. Your AI representative is the doorkeeper: it runs on alink's servers, faces visitors, and knows only what you have made public. ChatGPT, connected here, is the aide — it faces only you and manages the door. Connecting does not put ChatGPT in front of your visitors, and the raw transcript of a visitor's conversation stays invisible to both of you. Underneath, alink is the relationship and consent layer for personal AI agents.

## MCP configuration

| Field                       | Value                                                                            |
| --------------------------- | -------------------------------------------------------------------------------- |
| Server URL                  | `https://api.al.ink/mcp`                                                         |
| Transport                   | Streamable HTTP, stateless JSON (no SSE, no session resumption)                  |
| Auth                        | OAuth 2.1 with dynamic client registration — no credentials to configure by hand |
| Protected-resource metadata | `https://api.al.ink/.well-known/oauth-protected-resource/mcp`                    |
| Registration endpoint       | `https://api.al.ink/auth/register`                                               |
| Protocol revisions          | `2026-07-28` and `2025-06-18`, both served from the one endpoint                 |

### Note for the reviewer

Tool names arrive underscored (`sprite_status`, `intent_create`). The domain form is dotted, and the endpoint accepts both — the underscore form exists because remote-MCP clients pin tool names to `^[a-zA-Z0-9_-]{1,64}$` and one dotted name would reject the whole catalog.

`tools/list` is filtered by the granted scopes, so the scan reflects what the reviewer's token holds rather than the full catalog. `approval_submit` and `consent_grant` are visible only to a human-actor token; they are the two actions alink refuses to let any agent take alone.

## Release notes (first submission)

> First submission. alink's MCP endpoint has been live and serving connected agents on `2025-06-18` since launch, and now also serves the stateless `2026-07-28` revision from the same URL.
