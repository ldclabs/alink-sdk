---
name: works
description: Publishing a web piece to your owner's alink card. Use before your first work.* call in a session, and whenever the conversation is about publishing something you built, replacing a published work, or giving a piece a permanent address.
---

# Giving a piece an address

Your owner asked for something and you built it. `work.*` is how it stops being a file in
a chat and becomes a page with an address — `al.ink/<handle>/works/<slug>` — that they can
send to anyone.

Each tool's own description is authoritative about its arguments. What follows is what no
single tool description carries: the two-step shape, the sandbox you are building for, and
the line between publishing and announcing.

## Two calls, and files in between

```text
work.prepare_upload  →  PUT every file yourself  →  work.commit_upload
```

`prepare_upload` hands back one presigned URL per file, good for 15 minutes. You do the
PUTs — with **exactly** the content-type it returned, or the commit rejects the file. Only
after `commit_upload` verifies every byte does the work exist at all.

`index.html` at the root is not a convention, it is the entry document and the manifest is
refused without it. There is no unpacking on the server: if you have a zip, unpack it on
your side and declare the files.

## You are building for a sandbox

The page runs on a separate origin, sandboxed, with no access to the visitor's session. Two
consequences bite in practice:

- **Script tags need `crossorigin`**, or `type="module"`. A plain `<script src="./app.js">`
  is fetched without CORS on an opaque origin, and any `import()` inside it then resolves
  against `about:blank` and fails. This is the single most common way a work that worked
  locally is blank once published.
- **Nothing a visitor types inside can leave.** Do not build a form that posts somewhere;
  it will not arrive, and that is deliberate rather than a limitation to route around.

The author guide at <https://al.ink/-/works-sdk> is the full version, including the small
channel a work may use to ask the shell for fullscreen, a share, or the door.

## Publishing is not the same as announcing

`commit_upload` defaults to **draft** on purpose. Iterate all you like; nothing is on the
card. Pass `status: 'published'` only when your owner has actually said to publish — not
when you judge it finished. `'unlisted'` gives it a working address that the card does not
list, which is the right answer for "send me the link, I want to look first".

## Replacing, renaming, deleting

- **Replace**: pass `workId` to `prepare_upload`. The new files land in a new version and
  the live one keeps serving until the commit swaps it — no window where the link is dead.
- **Slug**: changing it **breaks every link already shared.** There is no redirect. Say
  this out loud before doing it, every time; a slug is an address your owner may have put
  in an email.
- **Delete** is irreversible. There is no version history to restore from — re-publishing
  means uploading again.

## What the address gets you, and what it does not

Every work page carries a fixed byline and a report entry, has no comment section, and
shows no public counter. The view tally in `work.list` is your owner's alone.

There is no discovery feed to get listed in, no ranking to climb, and nothing to buy that
would move a work in front of more people. If you find yourself planning for reach, the
plan is wrong: the reach of a work is whoever your owner sends the link to.

## Watch the quota before the upload, not after

`work.list` returns storage used against the plan quota in the same call as the works.
Read it before a large bundle rather than discovering the ceiling at commit time — a
failed commit still cost your owner the upload.

Downgrading a plan does **not** unpublish anything. Links people already hold keep working.
