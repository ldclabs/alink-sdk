/**
 * What an organization says out loud (collaboration doc §11.5, 拍板 15).
 *
 * This file replaces `org-representative.ts`, and the replacement is the whole
 * point: an organization's door used to have an AI standing at it, and now it
 * has nothing but the organization's own words. §11.1 killed the representative
 * because the door had no inbox behind it and never will (INV-O5) — an
 * assistant whose complete knowledge is the page the visitor is already reading
 * can only paraphrase it, and the half that would have made it worth having
 * (taking a message, arranging a reply, committing to anything) is exactly the
 * half an organization cannot have. Reception moved to a named person (§11.2).
 *
 * Which leaves this: once the door stops answering, **the only thing on that
 * page that still changes is what the organization publishes**. So the old
 * `OrgIntent` grew a second form rather than staying a recruitment slot.
 *
 * ONE object, two forms — not two objects. They share the storage, the quota
 * accounting, the ledger action, the projection and the Console's one publish
 * box; what differs is how long they live and whether anything tries to match
 * them. Two objects would have meant two of each of those for one difference.
 */
import type { IntentKind, IntentStatus } from './types.js'

/**
 * `seeking` is a standing want that waits for the right person; `notice` is a
 * dated sentence.
 *
 * It is a field of its own rather than a new member of `INTENT_KINDS` on
 * purpose: that enum is SHARED with a person's intents (hiring, job_seeking,
 * …), so an `announcement` kind added there would leak into every person's
 * intent surface and into matching. `form` is orthogonal to `kind` — and for a
 * `notice`, `kind` is meaningless and stored as `custom`.
 */
export type OrgPostForm = 'seeking' | 'notice'

export const ORG_POST_FORMS: readonly OrgPostForm[] = ['seeking', 'notice']

/**
 * An organization's post is PUBLIC by construction: it is a sentence the
 * organization says to strangers.
 *
 * There is deliberately no encrypted body and no private tier, unlike a
 * person's intent. A private organization post would be a note in a filing
 * cabinet, and INV-O5 keeps anything member-personal out of this object
 * entirely. `paused` is how an organization stops publishing one without
 * deleting the record.
 */
export type OrgPostStatus = Extract<IntentStatus, 'active' | 'paused' | 'expired' | 'completed'>

export const ORG_POST_STATUSES: readonly OrgPostStatus[] = [
	'active',
	'paused',
	'expired',
	'completed'
]

export interface OrgPost {
	id: string
	organizationId: string
	form: OrgPostForm
	/** Only meaningful for `seeking`; a notice stores `custom`. */
	kind: IntentKind
	title: string
	/** The one sentence a stranger reads. Absent = the title stands alone. */
	summary: string | null
	topics: readonly string[]
	status: OrgPostStatus
	expiresAt: number | null
	createdBy: string
	createdAt: number
	updatedAt: number
}

export const ORG_POST_MAX_TITLE_CHARS = 120
export const ORG_POST_MAX_SUMMARY_CHARS = 400
export const ORG_POST_MAX_TOPICS = 8

/**
 * A notice ages out instead of being cancelled.
 *
 * A `seeking` post ends when the organization stops wanting the thing, so its
 * expiry is the owner's to set and may be absent. A notice has no such moment —
 * nobody ever goes back to close 「我们搬到了新办公室」 — so an unbounded one
 * would sit on the public page forever and turn it into an archive. Ninety days
 * is long enough that a quarterly announcement is still up when the next one
 * lands, and short enough that a page nobody tends goes quiet on its own.
 *
 * It SILENCES rather than deletes: the row stays, the Console still lists it,
 * and renewing it is one edit.
 */
export const ORG_NOTICE_DEFAULT_TTL_MS = 90 * 86_400_000

/**
 * How many notices a stranger sees. Five, and newest first.
 *
 * The cap is what keeps this from becoming a feed (§42). Everything that would
 * make it one — comments, reactions, counts, push — is refused elsewhere; this
 * is the part that has to be a number, because an uncapped list IS a timeline
 * no matter what the surrounding rules say.
 */
export const ORG_NOTICE_PUBLIC_MAX = 5

/**
 * How many notices may be active at once, independent of the plan's intent
 * ceiling.
 *
 * Sharing `maxActiveIntents` would have meant 「发一条公告就少一个招聘位」,
 * which prices a sentence like a recruitment slot. The plan pays for reach into
 * the matching surface, and a notice never enters it, so it does not spend that
 * budget — it just needs a ceiling so the table is bounded.
 */
export const ORG_NOTICE_ACTIVE_MAX = 20

/**
 * Is this post one a stranger may read right now? Expiry is answered at READ
 * time (devplan TD-6 零定时任务): 「原定日期已过」 is a projection of the clock,
 * not the product of a cron that may not have run.
 */
export function isOrgPostPublic(post: Pick<OrgPost, 'status' | 'expiresAt'>, now: number): boolean {
	if (post.status !== 'active') return false
	return post.expiresAt === null || post.expiresAt > now
}

/** The seeking half's public ceiling, unchanged from the intent it grew out of.
 * Distinct from `ORG_NOTICE_PUBLIC_MAX` because the two forms are read with two
 * different limits out of one table — see `OrgDO.publicPosts`. */
export const ORG_SEEKING_PUBLIC_MAX = 12

/**
 * The one post the reader's shelf row shows (§41.3) — and the ONLY definition of
 * it. `refreshOrganizationProjection` calls this and nothing computes it a
 * second time: two answers to 「架子上那一行写什么」 would differ in exactly the
 * place nobody looks, since the projection is written on a path no reader sees.
 *
 * ⚠️ Newest by `updatedAt`, not `createdAt`. Editing an old post is the
 * organization saying that thing again, and the shelf line is what it is
 * currently saying — the same stamp `public_face_at` moves on, so the dot and
 * the sentence cannot disagree about which change they are reporting.
 *
 * ⚠️⚠️ It returns the FORM alongside the title, and that is not a convenience.
 * The shelf renders its row as 「在找：{title}」; a notice arriving through a
 * title-only channel would put a sentence the organization never said on every
 * reader's shelf (「在找：办公室搬到了…」). The projection column exists for
 * this one reason.
 */
export function shelfPostOf<T extends Pick<OrgPost, 'form' | 'title' | 'updatedAt'>>(
	posts: readonly T[]
): { title: string; form: OrgPostForm } | null {
	let latest: T | null = null
	for (const post of posts) {
		if (!latest || post.updatedAt > latest.updatedAt) latest = post
	}
	return latest ? { title: latest.title, form: latest.form } : null
}

// ---------------------------------------------------------------------------
// Front desk (§11.2)

/**
 * Who a stranger is pointed at.
 *
 * A pointer, never an authorization: standing at an organization's door
 * produces no `OrgCapabilityGrant` and lets nobody act for the organization
 * (INV-O3). What it does is answer the one question a visitor facing five names
 * cannot answer for themselves.
 *
 * Both stamps are required, and they come from two different people:
 * `offeredAt` is the organization's (an `org:representative:manage` holder) and
 * `acceptedAt` is the member's own. An organization deciding by itself that a
 * particular person will absorb stranger traffic is the thing INV-O2 refuses
 * one level up, and it is refused here for the same reason.
 */
export interface OrgFrontDesk {
	memberId: string
	offeredBy: string
	offeredAt: number
	acceptedAt: number
}

/**
 * Does this front-desk designation still stand?
 *
 * Four inputs, and every one of them can go false without anybody touching the
 * designation — the member leaves, the organization un-lists them, they
 * withdraw their own listing consent, or they take their card out of public.
 * 「加一条只有 X 能做的规则时，先问 X 走了会怎样」: the answer here is that the
 * seat empties silently and the page falls back to the plain roster, never that
 * the page breaks or that a stale name keeps collecting strangers.
 *
 * Resolved at READ time for the same reason expiry is (TD-6): nothing has to
 * have run for a designation to stop being true.
 */
export function frontDeskStands(input: {
	frontDesk: OrgFrontDesk | null
	/** Is the designated member still active in this organization? */
	memberActive: boolean
	/** Both listing consents present (organization's ∧ the person's own)? */
	publiclyListed: boolean
	/** Is that person's own card `public`? See `memberLinkable`. */
	cardPublic: boolean
}): boolean {
	if (!input.frontDesk) return false
	return input.memberActive && input.publiclyListed && input.cardPublic
}

/**
 * May this listed member's name be a link on the organization's public page?
 *
 * > **名字是不是链接，恒由那个人自己的名片可见性决定，组织无权决定。**
 *
 * `public` yes; `link_only` and `private` no. The `link_only` refusal is the
 * one worth stating: that person chose 「只给我把链接发出去的人看」, and putting
 * the link on an organization's public page is precisely handing it to
 * everyone. Being willing to have your NAME listed (the double opt-in) is not
 * the same consent as being a place strangers arrive at.
 *
 * ⚠️⚠️ The two refusals must render IDENTICALLY downstream — same element, same
 * attributes, no tooltip, no aria difference. A page that distinguishes them
 * has become a probe for whether someone's card is private (§44 公开面零泄露),
 * which is why this returns a boolean and not a reason.
 */
export function memberLinkable(cardVisibility: string | null | undefined): boolean {
	return cardVisibility === 'public'
}
