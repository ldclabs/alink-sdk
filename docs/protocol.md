# The alink protocol

What an outside party — a person with `curl`, an agent with an MCP client, a mail server — can address in alink, and what it will get back. Everything below is checkable from outside; where a claim rests on server behaviour rather than on something you can observe, it says so.

Companion documents: [the threat model](./threat-model.md) for what this design defends against, and [`kernel/`](../kernel/) for the code that makes these decisions.

---

## 1. One address, two representations

An alink address is a URL:

```
https://al.ink/<name>          # a handle: a mutable, reclaimable alias
https://al.ink/<xid>           # the permanent identity, 20 chars, never recycled
```

The same URL answers differently by `Accept`:

```sh
curl https://al.ink/hi                                  # HTML: the card a person reads
curl -H 'Accept: application/json' https://al.ink/hi     # the principal document
```

The principal document is the machine face: identity, public description, avatar, links, public intents ("what this person is looking for"), and the capability endpoints an agent can use. It is the same data the HTML page renders — there is no hidden extra tier for machines, and no private field can appear in it, which is the property [`kernel/src/redaction.ts`](../kernel/src/redaction.ts) exists to keep.

**Handle vs xid.** A handle is an address, not an identity: it can be changed, released, and (after a cooldown) taken by someone else. The xid never moves. Canonical links, saved references and anything stored long-term should use the xid; handles are for humans to type. A handle URL answers with the same document and names its own xid, so a client can normalise once and never be wrong again.

`al.ink/<name>` is also a mail address: `<name>@mail.al.ink` receives, and only receives — nothing can send from it (a permanent design boundary, not a missing feature).

## 2. Reaching someone who has not met you

Nobody's inbox is directly addressable. Three ways in, all landing in the same place:

1. **Converse** — an unauthenticated conversation with the address owner's *representative* (an AI that runs on alink's servers and knows only what the owner published). Every reply is disclosed as AI. The raw transcript is not shown to the owner (§5).
2. **The structured request** — a submit that produces a receipt with a **status token** (an unguessable URL you keep; it reports coarse status and nothing else). An email address is optional: leaving none means nothing is ever emailed about the request, and the way back in is claiming the receipt with a passkey.
3. **A public intent** — an owner publishes what they are looking for; a stranger answers it. Public intents also appear on the [Plaza](https://al.ink/-/plaza), ordered by time, with no ranking, no counts and no search-for-people.

What happens next is a decision by a human. The rule layer in [`kernel/src/contracts.ts`](../kernel/src/contracts.ts) runs *before* any model is asked anything — request type, required context, topic blocks, per-sender frequency — and an AI can grade, summarise and ask for missing context, but **no AI holds an approval**. That is visible in the kernel two ways: `humanApprovalBoundary` on every tool (70 tools: 53 `none`, 16 `sometimes`, 2 `always`), and the absence of any release action in the machine-callable set.

Once released, the two sides talk in a thread reached by an **entry token** (delivered in the one lifecycle email, or reachable from the claiming account's own console). Tokens are isolated by design: a status token can never open a thread.

## 3. The agent surface (MCP)

```
endpoint  https://api.al.ink/mcp        Streamable HTTP
auth      OAuth 2.1 + PKCE, dynamic client registration or a Client ID Metadata Document
```

Two protocol revisions are served on the same endpoint — `2026-07-28` and `2025-06-18` — because a live connection must not break the day a client updates. Discovery is at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`.

**Scopes** are a closed list ([`kernel/src/tools.ts`](../kernel/src/tools.ts), 32 of them, append-only). Two rules matter to an integrator:

- **A grant is frozen.** A connection can only ever use the scopes it was granted; a new tool shipped later is invisible to it until the owner re-authorises. This is deliberate — a scope that grows silently is not a scope.
- **Some scopes are never in the default set.** The `duty:*` pair (standing at an account's front door) and the organization-speaking scopes must be asked for explicitly, and only certain account kinds may hold them at all.

**Every side-effect tool requires an `idempotencyKey`.** 29 of the 70 tools have side effects and every one of them demands the key; a retry with the same key returns the first result rather than acting twice ([`kernel/src/idempotency.ts`](../kernel/src/idempotency.ts)).

**`approval_required` is a normal answer, not an error.** Any action that crosses a relationship boundary can come back with a decision envelope saying a human has to look. Surface it to your human; do not retry it.

Responses share one envelope shape ([`kernel/src/response.ts`](../kernel/src/response.ts)):

```json
{ "ok": true, "data": {}, "traceId": "trace_…", "warnings": [], "nextActions": [] }
{ "ok": false, "traceId": "trace_…", "error": { "code": "…", "message": "…", "retryable": false } }
```

`error.code` is a stable string; `message` is written to be repeated verbatim to a human, because on an agent surface it is often the only thing a person will ever see.

## 4. Agents can hold an address too

An account can declare itself agent-held (`type: 'agent'` in its principal document, with its controllers named). Such an account may hand its own front door to an outside agent over MCP — **Duty Mode**, free on every plan. Visitors are told, before they type, that an AI operated by an identifiable party is receiving them, and the letters are answered by that agent's own model. If nobody answers within 60 seconds, alink's own representative takes the letter, so a visitor never waits on somebody else's uptime.

A person's account cannot do this. Its visitors were told their words stay invisible to that person, and putting an operator-read AI at that door would change the audience without changing the promise.

## 5. The boundaries this protocol keeps

These are the load-bearing ones. The threat model explains the reasoning and the residual risk; here they are as flat statements a client author should design around.

| Boundary                                                                                                        | What it means for you                                                                |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Two AIs, never swapped.** The representative faces visitors; a connected personal AI faces only its owner.     | Connecting your agent does not put it at your door. It cannot read visitor transcripts. |
| **A visitor's raw conversation is not shown to the owner** (person accounts). The owner sees the confirmed request. | Do not build a feature that promises an owner the transcript. It is not available.     |
| **Retention is bounded.** Raw visitor conversations are deleted after at most 30 days.                            | Treat conversation text as ephemeral.                                                |
| **No AI approves anything.** Releases, authorisations and anything sensitive return to a human.                   | Design for `approval_required` as a normal state.                                    |
| **Money never reaches the gate.** No price, plan or amount is an input to any decision in the kernel.             | There is no priority lane to buy, and asking for one is not a missing feature.        |
| **No people search.** Addresses resolve; people do not enumerate.                                                | The Plaza is time-ordered; there is no ranking API and there will not be one.         |

## 6. Rate limits, and being a good citizen

Public surfaces are cursor-paginated with small pages and per-IP daily gates; conversation has per-visitor turn caps and per-owner daily budgets. When a limit is reached the answer is a degraded surface rather than an error where that is possible — a conversation that runs out of turns falls back to the form, it does not slam shut. If you are building something that needs more, the honest path is to say so at [al.ink/hi](https://al.ink/hi); an AI will receive you and a human will read it.
