import { AlinkCoreError } from './errors.js'
import { GROVE_LINK_PATTERN, utcDayOf } from './grove.js'

// ---------------------------------------------------------------------------
// Sprite domain (docs/alink-sprite.md v0.4, devplan TD-S2/S3/S6). Pure: every
// answer here is a function of (stored facts, now) — no clock reads, no
// network, no storage. SpriteDO holds the facts; this file holds the rules.
//
// Two disciplines run through the whole file:
//
//   1. 驱动恒来自心智 (§2.10). Nothing here grants a human the power to make a
//      sprite move. `sleep` is the only state change the owner surface may
//      reach; every other transition arrives through an agent's MCP call.
//   2. 存在是纯函数 (§5.2 / TD-S2). Presence is one row plus `now`. There is no
//      heartbeat, no alarm, no sweeper: a lease that has run out is already
//      asleep the next time anyone looks.

// ---------------------------------------------------------------------------
// 世界的三个数字 (§3.5) — fixed by the world, configurable by no one.

/** 凝形: light takes this long to gather into a body, at home or on arrival. */
export const SPRITE_CONDENSE_MS = 42_000
/**
 * 做客: one visit to someone else's grove, then the root road home.
 *
 * Home, and still AWAKE (§5.2): the end of a visit is a journey, not a bedtime.
 * Only the day boundary puts a sprite to sleep on its own — see
 * `homecomingLease`.
 */
export const SPRITE_VISIT_MS = 42 * 60_000

/**
 * 在家最长到日界 (§3.5) — the same single UTC day boundary the dew ledger
 * already runs on, never a timezone-local one.
 *
 * With one floor: a wake 30 seconds before the boundary would otherwise
 * condense for 42s and fall asleep having existed for nothing. So a home lease
 * lasts至少 one visit's worth of time. The floor reuses the world's own number
 * rather than inventing a fourth one.
 */
export function homeLeaseExpiry(now: number): number {
	const dayBoundary = (utcDayOf(now) + 1) * 86_400_000
	return Math.max(dayBoundary, now + SPRITE_VISIT_MS)
}

/** 做客到点自动回家 — always exactly 42 minutes from the moment of departure. */
export function visitLeaseExpiry(now: number): number {
	return now + SPRITE_VISIT_MS
}

/** The moment the body finishes gathering and may begin to act. */
export function condenseActiveAt(now: number): number {
	return now + SPRITE_CONDENSE_MS
}

// ---------------------------------------------------------------------------
// 世界的分寸 — daily allowances nobody has to memorize (§3.5). They are not
// user settings and not agent parameters; when one is reached the world says a
// sentence instead of showing a counter.

/** wake/move calls per owner per UTC day (KV window `grove:rl:sprmove`). */
export const SPRITE_MOVES_PER_DAY = 24
/**
 * 新账号首日出门上限 (devplan §7 反滥用复查).
 *
 * The move window above bounds one account; it does not bound one PERSON with
 * twenty fresh accounts, and the thing those accounts would be for is standing
 * in strangers' groves. So an account's first 24 hours buy a smaller number of
 * OUTINGS — waking at home is untouched, because a new owner's first evening
 * watching their own sprite is the experience this whole feature is for.
 *
 * Six is chosen to be invisible to a real first day (同林同日一次 already means
 * six outings are six different groves) and expensive to a spray: the cost of a
 * seventh is a whole day of account age, which no amount of automation buys.
 */
export const SPRITE_FIRST_DAY_VISITS = 6
/** How long an account counts as new for the rule above. */
export const SPRITE_NEW_ACCOUNT_MS = 86_400_000

/**
 * The outing cap in force for an account of this age, or `null` when it is no
 * longer new and only the ordinary move window applies.
 *
 * `createdAt` is read out of the owner's xid (`xidCreatedAt`), so this costs
 * nothing on the wake path. An id it cannot read means no cap: nobody chooses
 * their own userId — it is minted by HandleRegistryDO — so an unparseable one
 * is our own legacy data, never an attack, and the failure mode worth avoiding
 * is silently capping a real account forever.
 */
export function spriteFirstDayVisitCap(createdAt: number | null, now: number): number | null {
	if (createdAt === null || now - createdAt >= SPRITE_NEW_ACCOUNT_MS) return null
	return SPRITE_FIRST_DAY_VISITS
}
/** 树下留言: per sprite per day, across all groves (owner daily ledger). */
export const SPRITE_MSG_PER_DAY = 3
/** 树下留言: per grove per day — enforced at the target, in its own row. */
export const SPRITE_MSG_PER_GROVE_PER_DAY = 1
/** 送出: seeds + fruits per sprite per day (needs `allowGift` as well). */
export const SPRITE_GIFTS_PER_DAY = 3
/** 同林同日一次 (§6.1): one grove hosts one owner's sprite once per UTC day. */
export const SPRITE_VISITS_PER_GROVE_PER_DAY = 1

/**
 * An uncommitted presence row older than this is a crashed saga, not a sprite
 * in flight (TD-S5). Mirrors UserDO's `IN_FLIGHT_RECLAIM_MS`.
 */
export const SPRITE_SAGA_RECLAIM_MS = 5 * 60_000

// ---------------------------------------------------------------------------
// 形态卡 (§4.1) — the one layer that always exists. Body and portrait are
// optional; the card is the fallback anchor for every environment.

export const SPRITE_SYMBOL_MAX_GRAPHEMES = 2
export const SPRITE_NAME_MAX_LENGTH = 16
export const SPRITE_ESSENCE_MAX_LENGTH = 60
export const SPRITE_ALT_TEXT_MAX_LENGTH = 120

/**
 * Grapheme caps are what a READER perceives; these are what a STORE pays.
 *
 * One grapheme can stack unbounded combining marks, so a "two character"
 * symbol can arrive as two thousand code units. The card is not a private
 * field: it is copied verbatim into `visiting_sprites.card_json` in every
 * grove that hosts this sprite and rides in that grove's JSON, which is the
 * exact budget the content-addressed body route exists to protect. Both caps
 * hold, and the code-unit one is loose enough that ordinary emoji (a flag is
 * four units, a joined sequence more) never come near it.
 */
export const SPRITE_SYMBOL_MAX_CHARS = 16
export const SPRITE_NAME_MAX_CHARS = 64
export const SPRITE_ESSENCE_MAX_CHARS = 240
export const SPRITE_ALT_TEXT_MAX_CHARS = 480

export interface SpriteAura {
	/** Core colour, `#rrggbb`. */
	core: string
	/** Glow colour, `#rrggbb`. */
	glow: string
}

export interface SpriteCard {
	symbol: string
	name: string | null
	essence: string
	aura: SpriteAura
	altText: string
}

const HEX_COLOR = /^#[0-9a-f]{6}$/
/**
 * C0/C1 controls and the bidi/zero-width family — invisible payload in a public
 * label is never a legitimate design choice.
 *
 * U+200D ZERO WIDTH JOINER is deliberately NOT in the set. It is the glue in
 * every joined emoji (👩‍💻, 🏳️‍🌈, family sequences), i.e. a large slice of the
 * exact character class a one-or-two-character symbol is FOR. Its abuse — one
 * grapheme built from an endless chain — is bounded by the code-unit caps
 * below instead, which is where an unbounded-length problem belongs.
 */
// eslint-disable-next-line no-control-regex
const INVISIBLE_CHARS =
	/[\u0000-\u001f\u007f-\u009f\u200b-\u200c\u200e-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/

function graphemesOf(value: string): string[] {
	const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
	if (Segmenter) {
		const segmenter = new Segmenter(undefined, { granularity: 'grapheme' })
		return Array.from(segmenter.segment(value), (s) => s.segment)
	}
	// Runtimes without Intl.Segmenter fall back to code points: stricter for
	// emoji sequences (a flag counts as two), never laxer.
	return Array.from(value)
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, ' ').trim()
}

function assertVisible(value: string, field: string): void {
	if (INVISIBLE_CHARS.test(value)) {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			`A sprite's ${field} carries visible text only.`
		)
	}
}

/** The companion to every grapheme cap: what the reader sees is bounded above,
 * and so is what every hosting grove has to store. */
function assertNotStuffed(value: string, max: number, field: string): void {
	if (value.length > max) {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			`This ${field} is far longer than it looks (${value.length} characters). Write it plainly, without stacked marks.`
		)
	}
}

function normalizeColor(value: unknown, field: string): string {
	if (typeof value !== 'string') {
		throw new AlinkCoreError('SPRITE_CARD_INVALID', `The aura ${field} must be a #rrggbb colour.`)
	}
	const lowered = value.trim().toLowerCase()
	const expanded = /^#[0-9a-f]{3}$/.test(lowered)
		? `#${lowered[1]}${lowered[1]}${lowered[2]}${lowered[2]}${lowered[3]}${lowered[3]}`
		: lowered
	if (!HEX_COLOR.test(expanded)) {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			`The aura ${field} must be a #rrggbb colour (got ${JSON.stringify(value)}).`
		)
	}
	return expanded
}

/**
 * Validate and normalize a form card. Throws `SPRITE_CARD_INVALID` with a
 * sentence the painter can act on — the agent is the author here, and a vague
 * rejection costs it a whole round trip.
 */
export function validateSpriteCard(input: unknown): SpriteCard {
	if (!input || typeof input !== 'object') {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			'A form needs a card: symbol, essence, aura, altText.'
		)
	}
	const raw = input as Record<string, unknown>

	if (typeof raw.symbol !== 'string') {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			'The card needs a symbol: one or two characters.'
		)
	}
	const symbol = raw.symbol.trim()
	assertVisible(symbol, 'symbol')
	assertNotStuffed(symbol, SPRITE_SYMBOL_MAX_CHARS, 'symbol')
	const symbolLength = graphemesOf(symbol).length
	if (symbolLength < 1 || symbolLength > SPRITE_SYMBOL_MAX_GRAPHEMES) {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			`The symbol is one or two characters (got ${symbolLength}).`
		)
	}

	let name: string | null = null
	if (raw.name !== undefined && raw.name !== null) {
		if (typeof raw.name !== 'string') {
			throw new AlinkCoreError('SPRITE_CARD_INVALID', 'A name is text, or nothing at all.')
		}
		const trimmed = oneLine(raw.name)
		if (trimmed.length > 0) {
			assertVisible(trimmed, 'name')
			assertNotStuffed(trimmed, SPRITE_NAME_MAX_CHARS, 'name')
			if (graphemesOf(trimmed).length > SPRITE_NAME_MAX_LENGTH) {
				throw new AlinkCoreError(
					'SPRITE_CARD_INVALID',
					`A name is short: at most ${SPRITE_NAME_MAX_LENGTH} characters.`
				)
			}
			if (GROVE_LINK_PATTERN.test(trimmed)) {
				throw new AlinkCoreError('SPRITE_CARD_INVALID', 'A name carries words, not links.')
			}
			name = trimmed
		}
	}

	if (typeof raw.essence !== 'string') {
		throw new AlinkCoreError('SPRITE_CARD_INVALID', 'The card needs one line of essence.')
	}
	const essence = oneLine(raw.essence)
	if (essence.length === 0) {
		throw new AlinkCoreError('SPRITE_CARD_INVALID', 'The card needs one line of essence.')
	}
	assertVisible(essence, 'essence')
	assertNotStuffed(essence, SPRITE_ESSENCE_MAX_CHARS, 'essence')
	if (graphemesOf(essence).length > SPRITE_ESSENCE_MAX_LENGTH) {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			`Essence is one line: at most ${SPRITE_ESSENCE_MAX_LENGTH} characters.`
		)
	}
	if (GROVE_LINK_PATTERN.test(essence)) {
		throw new AlinkCoreError('SPRITE_CARD_INVALID', 'Essence carries words, not links.')
	}

	if (typeof raw.altText !== 'string') {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			'altText is required: describe it for people who cannot see it.'
		)
	}
	const altText = oneLine(raw.altText)
	if (altText.length === 0) {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			'altText is required: describe it for people who cannot see it.'
		)
	}
	assertVisible(altText, 'altText')
	assertNotStuffed(altText, SPRITE_ALT_TEXT_MAX_CHARS, 'altText')
	if (graphemesOf(altText).length > SPRITE_ALT_TEXT_MAX_LENGTH) {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			`altText is a sentence: at most ${SPRITE_ALT_TEXT_MAX_LENGTH} characters.`
		)
	}
	if (GROVE_LINK_PATTERN.test(altText)) {
		throw new AlinkCoreError('SPRITE_CARD_INVALID', 'altText carries words, not links.')
	}

	const auraRaw = raw.aura
	if (!auraRaw || typeof auraRaw !== 'object') {
		throw new AlinkCoreError(
			'SPRITE_CARD_INVALID',
			'The card needs an aura: a core colour and a glow colour.'
		)
	}
	const aura: SpriteAura = {
		core: normalizeColor((auraRaw as Record<string, unknown>).core, 'core'),
		glow: normalizeColor((auraRaw as Record<string, unknown>).glow, 'glow')
	}

	return { symbol, name, essence, aura, altText }
}

// ---------------------------------------------------------------------------
// 主人的三个开关 (§7.2 / TD-S6). Not a settings page — three switches, and the
// only one that defaults to off is the one that gives away the owner's things.

export interface SpriteSettings {
	autoFormUpdate: boolean
	allowMessages: boolean
	allowGift: boolean
}

export const DEFAULT_SPRITE_SETTINGS: SpriteSettings = {
	autoFormUpdate: false,
	allowMessages: true,
	allowGift: false
}

// ---------------------------------------------------------------------------
// 存在 (§5.2, TD-S2)

export type SpritePlaceKind = 'home' | 'grove'

export interface SpritePlace {
	kind: SpritePlaceKind
	/** Grove owner xid for `grove`; the sprite's own owner for `home`. */
	xid: string
}

/** The single presence row, epoch-overwritten. */
export interface SpritePresenceRow {
	epoch: number
	placeKind: SpritePlaceKind
	placeXid: string
	committed: boolean
	issuedAt: number
	activeAt: number
	expiresAt: number
	endedAt: number | null
}

export type SpritePresenceState = 'sleeping' | 'arriving' | 'active'

export interface SpritePresenceView {
	state: SpritePresenceState
	place: SpritePlace | null
	/** When the body finishes condensing (only meaningful while not sleeping). */
	activeAt: number | null
	/** When the lease runs out (only meaningful while not sleeping). */
	expiresAt: number | null
}

/**
 * Presence = f(row, now). Reading is settling: nothing is written, no timer
 * exists, and a lease that has expired reads as `sleeping` forever after.
 *
 * One hardening over the devplan sketch: an uncommitted row never reads as
 * `active`. While the saga is in flight the light is still on the root road —
 * it holds a seat but cannot act. Past `SPRITE_SAGA_RECLAIM_MS` the row is
 * treated as a crash and collapses to `sleeping`, self-healing without a
 * sweeper.
 *
 * ⚠️ An expired VISIT reads as `sleeping` here, and that is not the whole
 * story: 做客到点回家之后它还醒着 (§5.2). The handover is `homecomingLease`, and
 * SpriteDO settles it into the row before anyone reads this — so a caller that
 * hands a raw row straight to this function is asking «what does this lease say
 * by itself», not «where is the sprite».
 */
export function presenceState(
	row: SpritePresenceRow | null | undefined,
	now: number
): SpritePresenceView {
	const asleep: SpritePresenceView = {
		state: 'sleeping',
		place: null,
		activeAt: null,
		expiresAt: null
	}
	if (!row) return asleep
	if (row.endedAt !== null && row.endedAt !== undefined) return asleep
	if (now >= row.expiresAt) return asleep

	const place: SpritePlace = { kind: row.placeKind, xid: row.placeXid }
	if (!row.committed) {
		if (now - row.issuedAt > SPRITE_SAGA_RECLAIM_MS) return asleep
		return { state: 'arriving', place, activeAt: row.activeAt, expiresAt: row.expiresAt }
	}
	if (now < row.activeAt) {
		return { state: 'arriving', place, activeAt: row.activeAt, expiresAt: row.expiresAt }
	}
	return { state: 'active', place, activeAt: row.activeAt, expiresAt: row.expiresAt }
}

/** 巢态 (§4.3 of the devplan): what the grove page shows where the nest is. */
export type SpriteNestState = 'none' | 'sleeping' | 'awake' | 'away'

/**
 * Derive the nest badge for a grove page. `away` never carries a destination:
 * where a sprite is standing is disclosed by the grove it stands in, never
 * broadcast by its owner's page (§5.1).
 */
export function nestStateOf(
	born: boolean,
	presence: SpritePresenceView,
	homeXid: string
): SpriteNestState {
	if (!born) return 'none'
	if (presence.state === 'sleeping') return 'sleeping'
	if (presence.place && presence.place.kind === 'grove' && presence.place.xid !== homeXid)
		return 'away'
	return 'awake'
}

/**
 * 做客到点，走根路回家 —— 回到家里，醒着 (§5.2).
 *
 * A visit ends where every journey in this world ends: at the destination, in
 * the light. The destination of the way back is the nest, and arriving somewhere
 * has never meant falling asleep — so the lease that runs out at the end of 42
 * minutes hands over to a HOME lease, and the only thing that puts a sprite to
 * sleep by itself is the day turning over (§3.5).
 *
 * Deliberately a function of the row alone, never of `now`: the answer is the
 * same whether the world looks a second after the visit ended or an hour later,
 * which is what lets a caller MATERIALIZE it (SpriteDO settles the row on the
 * next read) without the result depending on who happened to look first.
 *
 * Returns null when there is nothing to hand over:
 *
 *   · a lease that ended on purpose — the owner's brake, 被请离, a compensated
 *     saga (§5.2 «异常永远回落到 sleeping»). Being sent home is not the same
 *     event as coming home, and only one of them leaves the light on;
 *   · a lease that was never committed — it never arrived, so it cannot return;
 *   · a home lease — a night at home ends at the day boundary, full stop;
 *   · a visit whose homecoming has itself already run past the day boundary:
 *     it came home, it was awake for a while, and then it slept.
 */
export function homecomingLease(
	row: SpritePresenceRow | null | undefined,
	now: number
): { issuedAt: number; activeAt: number; expiresAt: number } | null {
	if (!row) return null
	if (row.endedAt !== null && row.endedAt !== undefined) return null
	if (!row.committed) return null
	if (row.placeKind !== 'grove') return null
	if (now < row.expiresAt) return null
	const issuedAt = row.expiresAt
	const expiresAt = homeLeaseExpiry(issuedAt)
	if (now >= expiresAt) return null
	return { issuedAt, activeAt: issuedAt + SPRITE_CONDENSE_MS, expiresAt }
}

// ---------------------------------------------------------------------------
// 常驻醒来令 (§5.5)
//
// The gap this closes is not «the owner cannot wake it» — that one is load
// bearing (§2.10) — but «the mind is not there at 8am». A ChatGPT or a Claude
// exists for the few minutes its person has it open; a body whose only driver
// is an intermittent mind sleeps through almost every day it is alive.
//
// So a mind may say one thing that outlives its own session: «wake at home,
// every day». Three properties keep that from becoming a wake button:
//
//   1. **A mind places it, never a person.** Setting one is `sprite.wake`, i.e.
//      the drive surface. The owner's face can only END it, which is a brake.
//   2. **It authorizes PRESENCE, nothing else.** Waking costs nothing and takes
//      nothing (§3.5); every action still needs the mind to call for it. That
//      is what keeps 家里的浇水与摇树留给人 (§2.8) true — the standing order
//      cannot spend a single drop of the owner's dew.
//   3. **It is settled by reading, like everything else here.** No alarm, no
//      cron, no daily sweep: the lease it hands over is a function of the day
//      and the order, so whoever looks first materializes exactly the same row
//      anyone else would have (`standingWakeLease`, mirroring `homecomingLease`).

/**
 * How long an order survives with no mind coming back for it.
 *
 * Not «how long the order is useful» — it is a liveness check on the mind that
 * placed it. Every agent-driven entry point refreshes `seenAt` (status, wake,
 * look, act — `touchStandingWake` in services/sprite.ts), so this only ever
 * bites when nobody has driven this body for a month, and what it restores then
 * is exactly the right sentence: a sleeping nest waiting for a mind (§10.3),
 * rather than a light that keeps coming on for nobody.
 *
 * ⚠️ Hanging that refresh off one tool would ask a different question. An agent
 * that caches state and only ever calls `sprite.wake` IS driving this sprite,
 * and must not have its order expire under it.
 */
export const SPRITE_STANDING_TTL_MS = 30 * 86_400_000

export interface SpriteStandingOrder {
	/** The mind that placed it — the same string the journal's `driver` carries. */
	by: string
	/** When it was placed. Never moves; `seenAt` is the one that does. */
	placedAt: number
	/** When a mind last touched this sprite at all — the TTL's clock. */
	seenAt: number
}

/**
 * 常驻醒来 —— 它不是在某一刻醒来的，是这一天第一次被看见时它已经醒着 (§5.5).
 *
 * Deliberately anchored to the DAY, not to `now`: the lease is issued at the
 * UTC day boundary and condenses in the 42 seconds after it, so every reader on
 * a given day computes identical numbers, and — the part that matters — nothing
 * the owner does causes the waking. Opening the grove page at ten in the morning
 * finds a sprite that has been awake since the day turned, not one that stands
 * up because it was looked at. A light that comes on when you walk in is a
 * light you switched on.
 *
 * Returns null when there is nothing to settle:
 *
 *   · no order, or one whose mind has been gone a month;
 *   · an order placed today — the call that placed it did today's waking;
 *   · a lease ENDED today: the owner's brake, 被请离, a compensated saga. Same
 *     line `homecomingLease` draws — 结束过的租约不交接任何东西, and a standing
 *     order is not a way to overrule the brake somebody pressed this morning;
 *   · a sprite that is already awake or taking shape.
 */
export function standingWakeLease(
	row: SpritePresenceRow | null | undefined,
	order: SpriteStandingOrder | null | undefined,
	now: number
): { issuedAt: number; activeAt: number; expiresAt: number } | null {
	if (!order) return null
	if (now - Math.max(order.placedAt, order.seenAt) > SPRITE_STANDING_TTL_MS) return null
	const dayStart = utcDayOf(now) * 86_400_000
	if (order.placedAt >= dayStart) return null
	if (row) {
		if (row.endedAt !== null && row.endedAt !== undefined && row.endedAt >= dayStart) return null
		if (presenceState(row, now).state !== 'sleeping') return null
	}
	// `homeLeaseExpiry` of a day boundary is the NEXT day boundary (its 42-minute
	// floor never reaches that far), so this lease always covers the rest of the
	// day it belongs to — there is no «woke up already expired» case to guard.
	return {
		issuedAt: dayStart,
		activeAt: condenseActiveAt(dayStart),
		expiresAt: homeLeaseExpiry(dayStart)
	}
}

/** A sprite may only act where it stands, and only once it has finished
 * condensing. Returns the reason so callers can say a true sentence. */
export function actionGate(
	presence: SpritePresenceView,
	placeXid: string
): { ok: true } | { ok: false; reason: 'sleeping' | 'arriving' | 'elsewhere' } {
	if (presence.state === 'sleeping') return { ok: false, reason: 'sleeping' }
	if (presence.state === 'arriving') return { ok: false, reason: 'arriving' }
	if (!presence.place || presence.place.xid !== placeXid) return { ok: false, reason: 'elsewhere' }
	return { ok: true }
}

// ---------------------------------------------------------------------------
// 林子的两道门槛 (WP-S7) — 精灵长在一片被照料过的林子里
//
// Both gates read the sprite owner's OWN grove, and both exist for the same
// reason: a sprite is what a tended grove grows, not a thing handed out at
// signup. What separates them is who can satisfy them.
//
//   · 出生 asks for something the owner does alone and can do today — one tree
//     on their own land. It must never depend on another person, because the
//     empty nest is the site's most important invitation (§10.3) and an
//     invitation to a task you cannot finish yourself is a dead end.
//   · 第一次出门 asks the owner to open their own door — nothing more. Whether
//     anyone walks through it is not theirs to control, so it is not asked of
//     them.

/** What the owner's own grove says about their sprite's two firsts. */
export interface SpriteGroveGate {
	/** Active trees on the OWNER's own beds (the guest plot never counts: that
	 * tree is someone else's doing, and its owner may hand it back). */
	ownTrees: number
	/** 来客地开着 — `guestPlotTakesPlantRequests`, the same predicate the walk
	 * index and the public read publish. `seed_drop` does NOT count: it takes
	 * seeds, not plant requests, so no stranger could ever leave a tree there. */
	doorOpen: boolean
	/** The most recent person who planted in this owner's guest plot, if any —
	 * archived trees included, so handing a tree back never erases the fact
	 * that they once came. */
	guestPlanterXid: string | null
}

/** 出生 (§3.1): a sprite is born into a grove that already has something
 * growing in it. One tree, on the owner's own land, planted by them. */
export function birthGate(gate: SpriteGroveGate): { ok: true } | { ok: false; reason: 'no_tree' } {
	return gate.ownTrees > 0 ? { ok: true } : { ok: false, reason: 'no_tree' }
}

/**
 * 第一次出门 (§6.1, WP-S7): the root road opens once the owner's own guest plot
 * is open to the world.
 *
 * The gate is the door's SETTING, never a guest actually having arrived: a
 * sprite whose owner has done everything right must not be stranded at home
 * waiting on a stranger. Once it has been out once, this never asks again.
 */
export function firstOutingGate(
	gate: SpriteGroveGate,
	hasBeenOut: boolean
): { ok: true } | { ok: false; reason: 'door_closed' } {
	if (hasBeenOut || gate.doorOpen) return { ok: true }
	return { ok: false, reason: 'door_closed' }
}

// ---------------------------------------------------------------------------
// 容量 (§6.2)

/**
 * 来访精灵容量 = 林子里**活着的树**的棵数 (WP-S7).
 *
 * It used to be the plot count, a constant 4 — which meant an empty patch of
 * land and a full grove seated exactly as many visitors. Counting trees makes
 * the number mean something: **一棵树，一束光**. Room to receive is something a
 * grove grows rather than something it is issued, the guest-plot tree someone
 * else planted counts too, and a grove with nothing growing in it has no
 * standing room at all rather than four empty seats.
 *
 * The owner's own sprite lives in the nest and never counts —
 * «无论林子是否坐满，精灵永远回得了家» (§3.2).
 */
export function visitorCapacity(treeCount: number): number {
	return Math.max(0, Math.floor(treeCount))
}

export interface VisitingSpriteRow {
	spriteOwnerId: string
	expiresAt: number
	utcDay: number
}

/** Lazy capacity read: expired guest rows are simply not there any more. */
export function activeVisitors<T extends { expiresAt: number }>(
	rows: readonly T[],
	now: number
): T[] {
	return rows.filter((row) => now < row.expiresAt)
}

export type AdmitVerdict = 'ok' | 'blocked' | 'full' | 'already_today' | 'no_trees'

/**
 * The seat half of 一道门 (§6.1). Visibility and blocks are decided by the
 * grove's own visitor wall before this is consulted — this function only
 * answers «is there room, and has this sprite already been here today».
 *
 * `no_trees` is deliberately its own verdict rather than a capacity of zero
 * wearing the word «full» (WP-S7): «坐满了» invites you to come back later, and
 * a bare patch of land will not have filled up by evening. The two refusals ask
 * different things of the visitor, so they are different sentences.
 */
export function admitVerdict(
	rows: readonly VisitingSpriteRow[],
	spriteOwnerId: string,
	treeCount: number,
	now: number
): AdmitVerdict {
	const today = utcDayOf(now)
	if (rows.some((row) => row.spriteOwnerId === spriteOwnerId && row.utcDay === today)) {
		return 'already_today'
	}
	const capacity = visitorCapacity(treeCount)
	if (capacity === 0) return 'no_trees'
	const live = activeVisitors(rows, now).filter((row) => row.spriteOwnerId !== spriteOwnerId)
	if (live.length >= capacity) return 'full'
	return 'ok'
}

// ---------------------------------------------------------------------------
// 姿态 (§7.2 L1): gestures cost nothing and mean nothing beyond themselves.

export type SpritePose = 'stand' | 'sit' | 'wave' | 'look'

const SPRITE_POSES: readonly SpritePose[] = ['stand', 'sit', 'wave', 'look']

export function isSpritePose(value: unknown): value is SpritePose {
	return typeof value === 'string' && (SPRITE_POSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// 经历 (§9.1): milestones, not experience points. Append-only, deterministic
// ids, earned once ever.

export const SPRITE_EXPERIENCE_TYPES = [
	'born',
	'first_wake',
	'first_outing',
	'first_water_away',
	'first_message',
	'first_gift',
	'first_meeting',
	'groves_visited_7'
] as const

export type SpriteExperienceType = (typeof SPRITE_EXPERIENCE_TYPES)[number]

/** 走过第七片林子 — the one milestone with a number in it. */
export const SPRITE_GROVES_VISITED_MILESTONE = 7

export interface SpriteExperience {
	id: string
	type: SpriteExperienceType
	occurredAt: number
	placeXid: string | null
}

export type SpriteMilestoneEvent =
	'born' | 'wake' | 'arrive_away' | 'water_away' | 'message' | 'gift' | 'meet'

export interface SpriteMilestoneContext {
	/** Types already earned — the once-ever guard. */
	earned: ReadonlySet<SpriteExperienceType> | readonly SpriteExperienceType[]
	occurredAt: number
	/** Where it happened; `null` at home or where place must not be recorded. */
	placeXid?: string | null
	/** Distinct groves visited INCLUDING this arrival (only used by `arrive_away`). */
	distinctGrovesVisited?: number
}

/** Deterministic id: one row per type, forever. Replaying the same action can
 * only ever produce the same primary key. */
export function spriteExperienceId(type: SpriteExperienceType): string {
	return `sxp_${type}`
}

/**
 * Which milestones this event earns. Pure and idempotent: feeding the same
 * event twice with the resulting `earned` set produces nothing the second time.
 */
export function deriveExperiences(
	event: SpriteMilestoneEvent,
	ctx: SpriteMilestoneContext
): SpriteExperience[] {
	const earned = ctx.earned instanceof Set ? ctx.earned : new Set(ctx.earned)
	const placeXid = ctx.placeXid ?? null
	const out: SpriteExperience[] = []
	const earn = (type: SpriteExperienceType): void => {
		if (earned.has(type)) return
		earned.add(type)
		out.push({ id: spriteExperienceId(type), type, occurredAt: ctx.occurredAt, placeXid })
	}

	switch (event) {
		case 'born':
			earn('born')
			break
		case 'wake':
			earn('first_wake')
			break
		case 'arrive_away':
			// Going out is also the first time it woke somewhere, if the owner's
			// very first command sent it straight to a friend's grove.
			earn('first_wake')
			earn('first_outing')
			if ((ctx.distinctGrovesVisited ?? 0) >= SPRITE_GROVES_VISITED_MILESTONE) {
				earn('groves_visited_7')
			}
			break
		case 'water_away':
			earn('first_water_away')
			break
		case 'message':
			earn('first_message')
			break
		case 'gift':
			earn('first_gift')
			break
		case 'meet':
			earn('first_meeting')
			break
	}
	return out
}

// ---------------------------------------------------------------------------
// 行动日志 (§9.3): the visible half of delegation. Structured enumerations, no
// free text, rolling retention — a record of what the AI spent, not a memory.

export const SPRITE_JOURNAL_RETENTION_MS = 7 * 86_400_000
export const SPRITE_JOURNAL_MAX_ROWS = 200

export const SPRITE_JOURNAL_KINDS = [
	'wake',
	'arrive',
	'look',
	'water',
	'shake',
	'pick',
	'message',
	'gift',
	'wave',
	'sit',
	'dismissed',
	'home'
] as const

export type SpriteJournalKind = (typeof SPRITE_JOURNAL_KINDS)[number]

export type SpriteJournalResult = 'ok' | 'full' | 'blocked' | 'budget' | 'error'

/** What a single action cost the owner. Never a balance — only the delta. */
export interface SpriteActionCost {
	dew?: number
	shake?: number
	gift?: number
	message?: number
}

export interface SpriteJournalEntry {
	at: number
	placeXid: string | null
	kind: SpriteJournalKind
	ref: string | null
	cost: SpriteActionCost | null
	/** Agent id, or `owner` when the owner pressed a brake. */
	driver: string
	result: SpriteJournalResult
}

export function journalEntry(input: {
	at: number
	placeXid?: string | null
	kind: SpriteJournalKind
	ref?: string | null
	cost?: SpriteActionCost | null
	driver: string
	result?: SpriteJournalResult
}): SpriteJournalEntry {
	const cost = input.cost && Object.keys(input.cost).length > 0 ? input.cost : null
	return {
		at: input.at,
		placeXid: input.placeXid ?? null,
		kind: input.kind,
		ref: input.ref ?? null,
		cost,
		driver: input.driver,
		result: input.result ?? 'ok'
	}
}

/** Rows a write should sweep: older than the window, or past the row cap. */
export function journalPruneBefore(now: number): number {
	return now - SPRITE_JOURNAL_RETENTION_MS
}

// ---------------------------------------------------------------------------
// L2 预算 (TD-S6). The daily counters live in the OWNER's own grove ledger,
// beside the dew — «精灵的额度就是主人的额度» is a storage fact, not a promise.
// The per-grove note limit is decided at the target, in the row that already
// holds today's notes.

export interface SpriteDailyCounters {
	utcDay: number
	messagesSent: number
	giftsSent: number
}

export type SpriteBudgetKind = 'message' | 'gift'

export interface SpriteBudgetView {
	messagesRemaining: number
	giftsRemaining: number
}

/** Counters from another UTC day are simply not today's counters. */
export function spriteBudgetView(
	counters: SpriteDailyCounters | null | undefined,
	now: number
): SpriteBudgetView {
	const today = utcDayOf(now)
	const fresh = counters && counters.utcDay === today ? counters : null
	return {
		messagesRemaining: Math.max(0, SPRITE_MSG_PER_DAY - (fresh?.messagesSent ?? 0)),
		giftsRemaining: Math.max(0, SPRITE_GIFTS_PER_DAY - (fresh?.giftsSent ?? 0))
	}
}

export function hasBudget(view: SpriteBudgetView, kind: SpriteBudgetKind): boolean {
	return kind === 'message' ? view.messagesRemaining > 0 : view.giftsRemaining > 0
}

/**
 * 每林每日一条 — answered by the target grove from its own notes, so no list
 * of visited groves has to be carried around in the sprite's ledger.
 */
export function canLeaveNoteHere(notesFromThisSpriteToday: number): boolean {
	return notesFromThisSpriteToday < SPRITE_MSG_PER_GROVE_PER_DAY
}

// ---------------------------------------------------------------------------
// 形态版本链 (§4.3, TD-S7)

export type SpriteFormStatus = 'active' | 'superseded' | 'taken_down'

/** Bodies are kept for the most recent N versions; older versions keep their
 * card (the永远存在的降级锚) and drop the bytes. */
export const SPRITE_BODY_VERSIONS_KEPT = 20

export type SpriteStatus = 'unborn' | 'alive'

/**
 * Whether a submitted form publishes itself or waits for the owner.
 *
 * 出生与改名恒需主人确认 (§4.3). `autoFormUpdate` buys the agent ordinary
 * appearance changes — never the birth, and never the name.
 */
export function formNeedsConfirmation(input: {
	status: SpriteStatus
	autoFormUpdate: boolean
	previousName: string | null
	nextName: string | null
}): boolean {
	if (input.status === 'unborn') return true
	if (input.previousName !== input.nextName) return true
	return !input.autoFormUpdate
}
