/**
 * Signals domain kernel (product doc §8.3, WP5): the Encounter-statistics
 * vocabulary shared by the D1 layer (db/registry.ts), the service seam
 * (services/signals.ts) and the UserDO (bounce detection + digest tail).
 * Pure values and functions only — no I/O, no env.
 */

export type SignalKind =
	| 'view'
	| 'intent_view'
	| 'converse_started'
	/** One visitor question classified by the assistant (§8.3 问题类别, entry
	 * plan B1): CATEGORY lives in the bucket's `category` column, the
	 * answered|unanswered outcome in `origin`. Counts only — the question text
	 * never leaves the converse pipeline. */
	| 'converse_question'
	| 'submitted'
	| 'bounced'

/**
 * Fixed question-category vocabulary (entry plan B1). A closed enum is the
 * privacy design, not a convenience: a model-authored free-text "summary"
 * dimension would leak conversation content into the owner-visible panel,
 * which §5.1 (对话原文对主人不可见) forbids.
 */
export type FaqCategory =
	'pricing' | 'availability' | 'background' | 'media' | 'scheduling' | 'collab' | 'other'

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
	'pricing',
	'availability',
	'background',
	'media',
	'scheduling',
	'collab',
	'other'
]

/** Model output is a claim, not a fact — clamp to the enum so a misbehaving
 * model can neither explode the bucket PK nor smuggle text into the panel. */
export function normalizeFaqCategory(input: unknown): FaqCategory {
	return FAQ_CATEGORIES.includes(input as FaqCategory) ? (input as FaqCategory) : 'other'
}

export type SignalChannel =
	| 'direct'
	| 'qr'
	| 'social'
	| 'search'
	| 'referral'
	| 'internal'
	/** Arrived through an event intent wall (`?s=wall`, commercialization §15).
	 * Submissions carrying it feed the organizer report's 撮合数. */
	| 'event_wall'
	/** Clicked the link in an email signature (`?s=signature`, §8.3 渠道细分). */
	| 'signature'
	/** Clicked an embedded website badge/button (`?s=embed`, §8.3 渠道细分). */
	| 'embed'
	/** Arrived through a shared Share Moment card link (`?s=moment`, PRD v4
	 * §8.7 分享链接带来源归因 / §11.4 Share Moment 回流率). */
	| 'moment'
	/** Followed a sprite standing in someone's grove to its owner's card
	 * (`?s=sprite`, sprite §7.5 会走路的名片). THE value metric of the sprite
	 * layer: it is the moment a light led a real person to a real card, which is
	 * why it gets a channel of its own instead of clamping to `internal`.
	 *
	 * Not in tension with the metric iron law (devplan TD-S11): what the law
	 * forbids is a SPRITE's own visit producing a signal. This row is a HUMAN
	 * arrival on a card page — exactly the thing the sprite exists to cause. */
	| 'sprite'
	/** Walked into a grove because their own sprite brought something back from
	 * it (`?s=brought`, sprite §7.4). The single number the whole sprite layer
	 * is built to move: «精灵的成功不是精灵活跃，是人回来了».
	 *
	 * Same standing as `sprite` under the metric iron law — the row is a HUMAN
	 * arrival, caused by a sprite, which is exactly the thing being counted. */
	| 'brought'
	/** Followed the landing page's «walk into a real grove» CTA (`?s=landing`).
	 * The 门后面 chapter's only readable number, and the reason no anonymous
	 * beacon had to be invented for it: this arrival is already gated, deduped
	 * and owner-keyed like every other one. */
	| 'landing'
	/** Arrived as inbound mail to the owner's `<xid>@` alias (email-alias doc
	 * §5.4) — stamped by the Email Worker handler, never a client claim. */
	| 'email'
	/** Walked from one of the owner's works back to the person who made it
	 * (`?s=work`, works doc §4.5). The whole reason 房间四 exists on a card
	 * rather than on a portfolio host: a work is the best window there is, and
	 * this row is the number that says whether anyone came in through it. */
	| 'work'
	| 'other'

/** Rolling retention windows (PRD §13.1 「滚动窗口」, concrete values pinned
 * here and disclosed in docs/legal/privacy.md). Aggregates carry no identity,
 * so they keep a year of trend; identity events are the sensitive class and
 * keep a quarter. */
export const SIGNAL_DAILY_RETENTION_DAYS = 366
export const SIGNAL_IDENTITY_RETENTION_DAYS = 90

/** A converse session idle this long without converging to a submission
 * counts as `bounced` — someone came, talked, and walked away (§8.3 counts
 * the visitor who never submitted). */
export const CONVERSE_BOUNCE_IDLE_MS = 24 * 3_600_000

const SIGNAL_CHANNELS: readonly SignalChannel[] = [
	'direct',
	'qr',
	'social',
	'search',
	'referral',
	'internal',
	'event_wall',
	'signature',
	'embed',
	'moment',
	'sprite',
	'brought',
	'landing',
	'email',
	'other'
]

/** Client-supplied channels are claims, not facts — clamp to the enum so the
 * dimension stays bounded (a hostile beacon cannot explode the bucket PK). */
export function normalizeSignalChannel(input: unknown): SignalChannel {
	return SIGNAL_CHANNELS.includes(input as SignalChannel) ? (input as SignalChannel) : 'other'
}

/** Channels only server code may stamp ('email' = the Email Worker handler);
 * a CLIENT claiming one clamps to 'other' like any out-of-enum value. */
const SERVER_STAMPED_CHANNELS: readonly SignalChannel[] = ['email']

/** Normalize a client-claimed channel (beacon / form / agent submits). */
export function normalizeClaimedChannel(input: unknown): SignalChannel {
	const channel = normalizeSignalChannel(input)
	return SERVER_STAMPED_CHANNELS.includes(channel) ? 'other' : channel
}

export const isoDayUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
export const utcHour = (ms: number): number => new Date(ms).getUTCHours()

export interface SignalsWeekCounts {
	views: number
	intentViews: number
	conversations: number
	submissions: number
	bounces: number
	/** Boundary-crossing attempts: conversations + non-conversation submissions
	 * (a converged submission was already counted when its conversation began). */
	encounters: number
}

export const emptySignalsWeek = (): SignalsWeekCounts => ({
	views: 0,
	intentViews: 0,
	conversations: 0,
	submissions: 0,
	bounces: 0,
	encounters: 0
})

/** The bucket columns week totals are derived from. */
export interface SignalBucketLike {
	kind: string
	origin: string
	count: number
}

export function addSignalBucket(week: SignalsWeekCounts, row: SignalBucketLike): void {
	switch (row.kind) {
		case 'view':
			week.views += row.count
			break
		case 'intent_view':
			week.intentViews += row.count
			break
		case 'converse_started':
			week.conversations += row.count
			week.encounters += row.count
			break
		case 'submitted':
			week.submissions += row.count
			if (row.origin !== 'conversation') week.encounters += row.count
			break
		case 'bounced':
			week.bounces += row.count
			break
	}
}

export function signalsWeekHasActivity(week: SignalsWeekCounts): boolean {
	return (
		week.views > 0 ||
		week.intentViews > 0 ||
		week.conversations > 0 ||
		week.submissions > 0 ||
		week.bounces > 0
	)
}
