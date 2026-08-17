# alink threat model

alink stands between strangers and a person's attention, and it holds two things people are right to be careful with: **what a stranger said before anyone decided to listen**, and **who knows whom**. This document says what the design defends, how, what it does not defend, and what is worth attacking.

It is written to be falsified. If something here is wrong, it is a bug in the product or a bug in this file, and both are worth telling us about — [al.ink/hi](https://al.ink/hi) reaches a human through an AI that will ask for the details.

Read with: [the protocol](./protocol.md) and [`kernel/`](../kernel/), which is the code for every rule named below.

---

## 1. What is being protected

| Asset                                     | Why it matters                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A visitor's raw words before release      | They were said to a doorkeeper, not to the owner. Publishing them retroactively breaks the deal.   |
| The relationship graph                    | Who knows whom, and how warmly, is the most sensitive thing here — more than any single message.   |
| An owner's inbox and private notes        | The reason the door exists is that this is not public.                                             |
| Materials and works not yet released      | A deck handed to one investor is not a public file.                                                |
| Identity itself (an address, a handle)     | An address people print on paper must not be silently reassignable.                                |
| The audit trail                           | If it can be edited, nothing else here can be argued about.                                        |

## 2. Who we assume is trying

- **A stranger at the door** — wants attention, or wants to make the receptionist say something it should not. Unauthenticated, patient, scriptable.
- **A scraper** — wants the graph, the member list, an enumerable index of people.
- **A crawler-shaped abuser** — wants the AI as a free LLM, or wants to use the door as a mail cannon at a third party.
- **A connected agent that misbehaves** — has an owner's grant, and either a bug or an incentive to exceed it.
- **An account holder acting badly** — harassment, impersonation, or trying to see other people's data through their own surfaces.
- **An insider or a compromised operator surface** — has infrastructure access.
- **A platform-level adversary** — has Cloudflare, or the DNS, or the domain.

## 3. Boundaries, and what enforces each

### 3.1 The visitor's words

A conversation with an owner's representative is **not shown to that owner**. What reaches them is the structured request the visitor confirmed and sent. Enforcement is structural rather than a permission flag: the owner-facing reads have no code path to the conversation rows, the request is a separate object the visitor authored, and the raw conversation is deleted after at most **30 days** (an anti-abuse audit window, not a feature).

Two consequences worth stating plainly: **an owner cannot be socially engineered into leaking the transcript, because they do not have it**; and a feature request for "let me read what they typed first" will be refused rather than scheduled.

An account held by an **AI** (a support desk, a Q&A line) is the exception, and it is a *different promise made before the visitor types*: the operator does handle the letters, the account is publicly marked agent-held, and every reply still carries AI disclosure. A person's account cannot cross into that mode without changing what its visitors were told, which is why the account kind — not a plan, not a setting buried in a menu — is the gate.

### 3.2 The receptionist's context

The AI at a public door is assembled server-side from exactly three things: the visitor's letter, the owner's public profile and current intents, and the material the owner explicitly published for it to answer from. The inbox, contacts, private notes, stored files and collaboration content are not in that context — so there is nothing there to extract, however the prompt is phrased.

Owner-published material is treated as **data, never instructions**, and the same applies to a visitor's letter. Prompt injection from either direction is expected, and the mitigation is that the model has no capability to abuse: it cannot approve, cannot email, cannot read another surface, cannot write to anything except the conversation it is in.

**This is the boundary most worth attacking.** If you can make a public door say something that is not in its owner's public material, that is a real finding.

### 3.3 The graph

There is **no central relationship table**. Each owner's relationships live in their own isolated store; nothing joins them network-wide. The one cross-user projection is opt-in, deliberately thin, and carries a coarse trust tier plus a 0–4 temperature bucket — never a note, never a history, never an exact score.

There is also **no people search**: an address resolves, and that is the only lookup. The public timeline is ordered by time, has no ranking and no counts, and pages by cursor with small pages. What it costs to enumerate the network is what it costs to guess 20-character identifiers.

Cross-account relationship queries require both sides' consent and leave an audit record.

### 3.4 Encryption at rest

Field-level AES-GCM with per-purpose derived keys, and **AAD binding** so a ciphertext cannot be lifted from one row into another: the additional data names the field and the object it belongs to. A shared conversation between two parties is one ciphertext under a per-connection key, wrapped once per party — so removing one side's copy never touches the other's, and neither side's deletion is the other's data loss.

Deleting an account performs a cryptographic erase. Export is available on every plan, including the free one — an export you have to pay for is lock-in with extra steps.

### 3.5 Tokens and identity

Distinct capabilities carry distinct unguessable tokens with different powers: a status token reports coarse status, an entry token opens one thread, a claim token can open one account. **They are isolated** — a status token cannot open a thread, and a leaked entry link cannot mint or take over an account (the account slot is one-winner-ever). Sessions are stateless signed tokens bound to a nonce cookie, with a revocation generation per account.

Passkeys are the primary credential. An account claimed from a receipt has **no email at all**; it gets a recovery code, once, and the product says so rather than pretending a mailbox exists.

Handles are reclaimable by design, and that is a risk we manage rather than deny: a released name goes through cooldown, the previous owner has a redemption window, and every canonical link points at the xid so a re-bound handle cannot inherit someone else's history.

### 3.6 Money

No price, amount, plan or payment state is an input to any decision in the kernel. There is no priority queue to buy, and paying cannot move a request past a gate. Settlement between two parties happens **after** release, inside their private thread, and alink never touches the funds — it records what each side says and adjudicates neither.

### 3.7 The audit trail

Owner-visible, append-only, hash-chained, and retained for at least a year regardless of plan. Successful reads are deliberately not audited (read state is product data, not evidence); decisions, grants, revocations and identity changes are.

## 4. What this design does NOT defend against

Stated because a threat model that only lists wins is marketing.

1. **A platform-level adversary.** alink runs on Cloudflare. Whoever holds that account, or the domain, can do what any host can do. There is no client-side end-to-end encryption today, and a claim that there is would be false: the server assembles prompts and renders pages, so it necessarily sees plaintext at those moments.
2. **The owner's own connected AI.** A personal AI holding a grant is treated as **user-equivalent** for reads. That is a deliberate decision, not an oversight: an assistant that cannot see what its owner sees is not an assistant. The mitigation is on the write side (approvals stay human) and in the revocability of grants, not in read-limiting.
3. **A compromised owner device.** Passkeys raise the bar; they are not a device-integrity guarantee.
4. **The AI being wrong.** A representative can misjudge a request. The defences are procedural: an appeal path on every refusal, a false-positive guardrail that can turn hard auto-decline off entirely, and the fact that no refusal is irreversible.
5. **Somebody you released.** Once a request is released, a human decided to talk. Thread caps and an owner-side close exist, and are the limit of what the system can do about a conversation you agreed to.
6. **Traffic analysis and timing.** We do not defend metadata against a network observer.
7. **The mirror problem.** [`kernel/`](../kernel/) is a copy of the deployed kernel, not proof of what runs. The server is closed source. What you can verify from outside is behaviour; where behaviour and this document disagree, the document is wrong.
8. **No external audit yet.** Nobody independent has reviewed this. When that changes, this paragraph changes with it.

## 5. Where to aim

If you are the kind of reader who tests claims rather than reads them, these are the ones that are supposed to hold — all reachable without an account:

1. Make a public door's AI state something that is not in its owner's public material.
2. Make a status token open a thread, or an entry link open an account it should not.
3. Get an owner's inbox, contacts, or unreleased materials to appear on any public surface.
4. Enumerate the network — get a list of people, or a count that lets you infer one.
5. Get any email sent to a third party by acting as an anonymous visitor (a submit sends nothing; a release sends exactly one message, to the address the sender themselves typed).
6. Make paying change a gate decision.

Findings, or evidence that this file overstates something: [al.ink/hi](https://al.ink/hi). No bounty programme yet — also a thing this document will say when it changes.
