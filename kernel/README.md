# alink kernel

The part of [alink](https://al.ink) that decides things — published so the claims made on the website can be read instead of believed.

```sh
cd kernel && npm install && npm test    # 8 suites, 261 assertions, no alink account needed
```

It has **no runtime dependencies** and no infrastructure imports: no Cloudflare bindings, no database, no network, no `env`. Everything here is a pure function or a data table, which is why it can be lifted out of a private server and read on its own.

## What is in here

| File(s)                                    | What it decides                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                                 | Every domain object and enum — including the plan entitlement shape and the Contact Contract                                         |
| `state.ts`                                 | The state machines: relationship, request, consent, handle, subscription, intake. Illegal transitions throw, they do not silently no-op |
| `policy.ts`, `scoring.ts`                  | The policy engine and risk scoring — what an agent may do without a human, and what always comes back                                |
| `contracts.ts`                             | The Contact Contract templates and the deterministic intake rule layer that runs **before** any model is called                     |
| `tools.ts`                                 | The MCP tool catalogue: every tool, its required scopes, whether it has side effects, whether it can return `approval_required`      |
| `redaction.ts`                             | What may leave the server on a public surface, and what is stripped                                                                 |
| `audit.ts`                                 | Audit event construction and the hash chain                                                                                         |
| `billing.ts`                               | The plan entitlement matrix, including the dunning degrade (what pauses when a card fails, and what never does)                      |
| `idempotency.ts`, `response.ts`, `ids.ts`  | Idempotency fingerprints, the response envelope, prefixed ids / xid / handle rules and the reserved-name list                        |
| `grove.ts`, `sprite.ts`, `sprite-svg.ts`   | The world layer: growth, care, and the sprite's own drawing rules                                                                    |
| `organization.ts`, `collaboration.ts`      | Organizations and collaborations — membership, roles, the twelve-chair limit                                                         |
| `settlement.ts`, `locker.ts`, `works.ts`   | Settlement cards, the materials locker, published works                                                                             |
| `schema.ts`, `protocols.ts`, `webhook.ts`  | The control-plane table list, protocol constants, webhook HMAC                                                                       |

## What is NOT in here, and why that matters

This is the decision layer, not the server. Not published: the HTTP handlers, the Durable Objects, the queue consumers, the prompt assembly, the storage layout, the operator surfaces. So the code here lets you check **what the rules are** — it does not let you run alink, and it cannot prove that the deployed server obeys them.

Two honest consequences:

1. **Claims you can verify from this repo**: the shape of every rule; that an AI never holds an approval; that money never reaches the gate (no price, amount or plan appears in `policy.ts` or `contracts.ts` at all); which scopes each tool demands; what is stripped from public surfaces.
2. **Claims you cannot**: that the running deployment uses this exact kernel. What you can do from outside is watch the boundaries hold — [the threat model](../docs/threat-model.md) says which ones are worth testing and invites the attempt.

## Upstream, and drift

⚠️ **This is a one-way mirror.** The kernel lives in alink's private monorepo at `alink-core/src/domain`, and it is copied here byte-for-byte by `alink-core/scripts/export-kernel.mjs`. Editing files here does not change alink; a pull request that changes behaviour cannot be merged as-is, though it is a perfectly good way to tell us we are wrong.

The export has a `--check` mode that fails when the mirror has fallen behind, so 「we open-sourced it and let it rot」 is a command that breaks rather than a promise nobody re-reads.

## License

Apache-2.0, like the rest of this repository.
