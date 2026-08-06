# ChatGPT app directory

Draft submission materials for listing alink in ChatGPT's plugin/app directory. Nothing here is needed to *use* alink from ChatGPT — see the [root README](../README.md) for that. This directory exists only for the review submission.

The 2023 "ChatGPT plugin" format (`ai-plugin.json` + OpenAPI) is gone. The current directory is MCP-backed, so the thing being submitted is the endpoint we already publish: `https://api.al.ink/mcp`. There is no second manifest to maintain, which is why this directory holds prose rather than a JSON file.

- [`listing.md`](./listing.md) — the Info tab, field by field
- [`test-cases.md`](./test-cases.md) — starter prompts, 5 positive and 3 negative cases

## What the portal is

`platform.openai.com/plugins` → **Create plugin** → type **MCP**. It is a nine-step form: listing info, MCP config (URL, tool scan, domain verification), starter prompts, test cases with demo credentials, region availability, then attest and submit. Approval does not publish — publishing is a separate manual click afterwards.

## Blocked on a human

These steps need a signed-in OpenAI account and cannot be delegated:

1. **Developer identity verification** — individual or business, completed in the OpenAI platform *before* the form will accept a submission. Whichever identity is chosen here becomes the public publisher name, so it should be the one that matches `al.ink`'s DNS ownership.
2. **Apps Management write access** on the org role.
3. **Attest and submit**, and later **publish**.

## Gaps to close before submitting

- **Tool annotations are incomplete.** `alink-core/src/http/mcp.ts` emits only `readOnlyHint` and `idempotentHint`. The review asks for `destructiveHint` and `openWorldHint` too, and their absence is read as unset rather than false. The tools that need them:
  - `destructiveHint: true` — `locker.revoke_grant`, `locker.set_material_status` (disabling cascades revocation by default), `consent.revoke`.
  - `openWorldHint: true` — `intent.discover` and `network.path_to`, which reach beyond the caller's own account into the discovery graph.

  Everything else is honestly `false` on both. This is a change in the core repo, not here.

- **Domain verification token** — the form issues its own token for a TXT record on `al.ink`. It is separate from the MCP-registry `v=MCPv1` record; both live on the same name and do not conflict.
- **A demo account** for the reviewer, seeded with enough relationships and intents that the positive cases in [`test-cases.md`](./test-cases.md) return something, plus a sprite that has been out at least once (the first starter prompt reads its journal). `al.ink/demo` is not enough on its own — the reviewer needs to complete the OAuth flow, so it must be a real account with credentials we are willing to hand over.

## Rules that bite

- **Works publishing may not be reproducible from ChatGPT.** The upload flow is `work_prepare_upload` → the *client* PUTs each file to a presigned URL → `work_commit_upload`, and a connector that can only make MCP tool calls has no way to issue those PUTs. Verify against the current ChatGPT connector capabilities before submission; until verified, works stays out of the starter prompts and test cases (it already is), and if the reviewer cannot reproduce it, soften the works sentence in [`listing.md`](./listing.md) rather than argue.
- **The tool scan sees only what the token's scopes allow.** `listTools` filters by granted scopes, and drops every `humanApprovalBoundary: 'always'` tool unless the actor is a user rather than an agent. `approval.submit` and `consent.grant` are the two that vanish. If the reviewer's scan comes back with fewer than 68 tools, that is the reason, and the listing copy should not promise tools the scan cannot see.
- **`approval_required` is a feature, not an error.** Say so in the submission. A reviewer who reads a blocked cross-boundary action as a broken tool will fail us for the exact behaviour the product is built around — which is why three of the eight test cases are written to make it visible on purpose.
- **The two-AI boundary is a support-load question, not just a design one.** Connecting ChatGPT does *not* put ChatGPT at the visitor-facing door. If the listing blurs that, every approved user arrives with the wrong model of what they bought.
- Regions: the endpoint is global, but availability is a per-country checkbox in the form. Ship the same list the product is actually operated for.
