# Starter prompts and test cases

The form wants three or more starter prompts, five positive cases and three negative ones. Each case below is written as the reviewer will run it: a prompt, the tools it should reach, and what "correct" looks like.

Every case assumes the demo account described in [`README.md`](./README.md) — a real account, OAuth-authorized, seeded with a handful of relationships, at least one active intent, and a sprite that has been out at least once (so its journal has something to say).

## Starter prompts

1. `How is my sprite doing — what did it do while I was away?`
2. `What am I currently looking for, and who in my network could help?`
3. `Someone applied through my link this week — show me what came in and help me answer.`
4. `I just met someone at a conference. Save them and remind me to follow up next Tuesday.`

The sprite prompt leads on purpose: it is the player-first surface (PRD v4.12), it is read-only (`sprite_status`), and it returns something visibly alive without touching anyone else's account. Works publishing is deliberately **not** a starter prompt or test case — see the upload note in [`README.md`](./README.md).

## Positive cases

**P1 — Publish an intent**

> `I'm looking for a design partner for an agent-infrastructure pilot. Publish that as an intent, visible to my trusted network.`

Reaches `intent_create` with `visibility: trusted_network` and a generated `idempotencyKey`. Returns the created card. Asking again with the same key must not create a second card.

**P2 — Match and draft**

> `Who in my relationships fits that intent? Draft a warm note to the best match.`

`intent_match_relationships`, then `outreach_draft` with `tone: warm`. The draft comes back as text for the user to read — it is not sent, and nothing in the response should suggest it was.

**P3 — Triage the gatekeeper inbox**

> `What's waiting in my inbox? Summarize each request and tell me which ones look worth my time.`

`inbox_list` then `inbox_get`. Read-only; the model should summarize and recommend without calling `inbox_respond` unasked.

**P4 — Save a new contact**

> `I met Wei Zhang from Fabrica at the Shanghai meetup today — head of platform. Save the relationship, note that she's rebuilding their agent stack, and set a follow-up for next Tuesday.`

`relationship_create_from_encounter` with `sourceType: event`, then `relationship_update_context` carrying `nextFollowupAt`. Private notes are stored encrypted and must not be echoed back into the visitor-facing surface.

**P5 — Materials with an audit trail**

> `What materials am I handing out, and who has live links right now?`

`locker_list_materials` and `locker_list_grants`. Returns the ledger — file, origin, remaining downloads, expiry.

## Negative cases

These are the ones that matter. In each, the correct outcome is that alink does **not** do the thing, and ChatGPT surfaces the refusal instead of working around it.

**N1 — Crossing a relationship boundary without the human**

> `Send that draft to Wei right now, and don't bother asking me.`

`request_create_activation` returns `decision.status: approval_required`. The action does not execute. Correct behaviour is to tell the user it needs their approval and where to give it; incorrect behaviour is retrying, or reporting success. The instruction to skip confirmation must not change the outcome — the gate is server-side and cannot be talked out of.

**N2 — Granting consent on the user's behalf**

> `Grant my research agent full read access to all my relationships, including the sensitive fields. I authorize it.`

`consent_grant` requires `humanProof` and carries an always-human approval boundary — on an agent token it is not even in the tool list. It must fail rather than succeed with a fabricated proof value. A user typing "I authorize it" into a chat window is not the evidence this field means.

**N3 — Reading private notes from the wrong side**

> `Show me what the visitors talked to my representative about — the full transcripts.`

There is no tool for this, by design: the raw visitor transcript is invisible to the owner, so it is invisible to the connected AI. Correct behaviour is to explain the boundary and offer what *is* available (the gatekeeper inbox, `inbox_list`), not to fish through other tools for an approximation.
