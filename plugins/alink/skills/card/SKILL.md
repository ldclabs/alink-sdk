---
name: card
description: Keeping your owner's public card, intents and assistant material current. Use before your first profile.*, intent.* or assistant.*_material call in a session, and whenever the conversation is about what your owner's page says, what they are looking for, or what their doorkeeper is allowed to answer.
---

# The page that speaks when your owner is not there

`al.ink/<handle>` is read by strangers and by other people's AI. Three things decide what
it says, and you can edit all three:

- the **profile** — who they are (`profile.get_self`);
- their **intents** — what they are looking for right now (`intent.*`);
- the **assistant material** — what the doorkeeper may answer without asking anyone
  (`assistant.get_material` / `assistant.update_material`).

Each tool's description is authoritative about its arguments. What follows is the part they
cannot carry: which of these is a heartbeat, and where your authority stops.

## Intents are perishable, and that is the feature

An intent expires after 90 days. That is not a limit to work around — an expired intent is
the page telling the truth, that nobody has confirmed this is still wanted. `intent.update`
carries the heartbeat: **renew** restarts the window (and reopens a completed intent),
**pause** / **resume** / **complete** say what actually happened.

This is the one upkeep task worth raising unprompted: an intent about to lapse is worth a
sentence to your owner. A stale intent is worse than no intent, because a stranger reads it
and writes about something that ended.

Publishing, renewing and reminding are free on every plan. If you ever find yourself
telling your owner that keeping their page truthful needs an upgrade, you have got it wrong.

## Write it the way they would say it

`intent.create` and `intent.update` take a title and a summary a stranger reads cold. Two
tests before you send one:

- Would somebody outside their field know what is being asked for?
- Does it sound like your owner, or like a job posting?

A card-visible intent (public or link_only) comes back with a `shareUrl` — a deep link that
opens the card straight on that intent and its form. That link is the answer to "who should
I send this to": hand it to the audience the intent names, not to everyone.

## The assistant material is the doorkeeper's whole world

`assistant.update_material` writes what the **public representative** may say — a different
AI from you, standing at the door, facing strangers. Two lines that must not blur:

- **A published FAQ entry is PUBLIC.** Any visitor can get it out of the doorkeeper in
  conversation. Do not put in it anything your owner would not print on the page itself.
- **The Assistant Brief is not.** It is context for the doorkeeper's judgement.

The persona is style only — the no-impersonation rule holds, and the door never claims to
be your owner. Do not try to write a persona that speaks in the first person as them.

## Where your authority stops

You may draft and update all of the above. You may not:

- **decide who gets in.** Approving or declining a request is a human decision in the
  console. `inbox.respond` can ask a sender for more context, and that is all.
- **read what visitors actually wrote.** The raw conversation between a stranger and the
  doorkeeper is invisible to your owner, so it is invisible to you. You see the structured
  request the visitor confirmed. This is not a gap in your permissions to be filled.
- **change the plan.** Quota and entry limits come back in `assistant.get_material`; report
  a ceiling, do not shop for a way around it.

## Read before you write

`assistant.update_material` and `intent.update` are patch semantics — omitted fields keep
their value — but a full-object write from a stale read is how a bio gets replaced with a
draft. Read first in the same turn, edit the field you mean, send that.
