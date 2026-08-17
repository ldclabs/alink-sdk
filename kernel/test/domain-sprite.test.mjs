import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
	DEFAULT_SPRITE_SETTINGS,
	SPRITE_BODY_MAX_BYTES,
	SPRITE_BODY_MAX_NODES,
	SPRITE_CONDENSE_MS,
	SPRITE_FIRST_DAY_VISITS,
	SPRITE_GIFTS_PER_DAY,
	SPRITE_GROVES_VISITED_MILESTONE,
	SPRITE_JOURNAL_RETENTION_MS,
	SPRITE_MSG_PER_DAY,
	SPRITE_SAGA_RECLAIM_MS,
	SPRITE_STANDING_TTL_MS,
	SPRITE_VISIT_MS,
	actionGate,
	admitVerdict,
	birthGate,
	canLeaveNoteHere,
	condenseActiveAt,
	deriveExperiences,
	firstOutingGate,
	formNeedsConfirmation,
	hasBudget,
	homeLeaseExpiry,
	homecomingLease,
	isSpritePose,
	journalEntry,
	journalPruneBefore,
	nestStateOf,
	presenceState,
	sanitizeSpriteBody,
	standingWakeLease,
	spriteBodyHash,
	spriteBudgetView,
	spriteExperienceId,
	spriteFirstDayVisitCap,
	validateSpriteCard,
	visitLeaseExpiry,
	visitorCapacity,
	xidCreatedAt
} from '../src/index.js'
import { BODIES } from './fixtures/sprite-bodies.mjs'

const DAY = 86_400_000
/** 2026-07-26T06:00:00Z — mid-day, so the day boundary is far away. */
const NOON = Date.UTC(2026, 6, 26, 6)

function card(overrides = {}) {
	return {
		symbol: '九',
		name: '小九',
		essence: '走过很多树林的一点光。',
		aura: { core: '#E8A33D', glow: '#F6DCA8' },
		altText: '一只橘色九尾狐形状的精灵。',
		...overrides
	}
}

function throwsCode(fn, code) {
	try {
		fn()
	} catch (error) {
		assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`)
		return error
	}
	assert.fail(`expected ${code}, nothing thrown`)
}

// ---------------------------------------------------------------------------
// 世界的三个数字 (§3.5)

test('world constants are the three numbers, not parameters', () => {
	assert.equal(SPRITE_CONDENSE_MS, 42_000)
	assert.equal(SPRITE_VISIT_MS, 42 * 60_000)
	assert.equal(condenseActiveAt(NOON), NOON + 42_000)
	assert.equal(visitLeaseExpiry(NOON), NOON + 42 * 60_000)
})

test('a home lease runs to the UTC day boundary', () => {
	assert.equal(homeLeaseExpiry(NOON), Date.UTC(2026, 6, 27))
	// Exactly on the boundary: a whole fresh day, never a zero-length lease.
	assert.equal(homeLeaseExpiry(Date.UTC(2026, 6, 26)), Date.UTC(2026, 6, 27))
})

test('a home lease never expires before the sprite has finished condensing', () => {
	// 30s before the boundary the naive rule would grant a 30-second life, of
	// which 42 seconds are condensation. The floor is one visit's worth.
	const lateNight = Date.UTC(2026, 6, 26, 23, 59, 30)
	const expiry = homeLeaseExpiry(lateNight)
	assert.equal(expiry, lateNight + SPRITE_VISIT_MS)
	assert.ok(expiry > condenseActiveAt(lateNight))
})

// ---------------------------------------------------------------------------
// 形态卡 (§4.1)

test('a valid card is normalized, not merely accepted', () => {
	const out = validateSpriteCard(
		card({ aura: { core: '#E8A33D', glow: '#FFF' }, name: '  小九  ' })
	)
	assert.equal(out.name, '小九')
	assert.equal(out.aura.glow, '#ffffff')
	assert.equal(out.aura.core, '#e8a33d')
})

test('a card without a name is a card', () => {
	assert.equal(validateSpriteCard(card({ name: null })).name, null)
	assert.equal(validateSpriteCard(card({ name: '   ' })).name, null)
	const { name, ...withoutName } = card()
	void name
	assert.equal(validateSpriteCard(withoutName).name, null)
})

test('the symbol is one or two graphemes', () => {
	assert.equal(validateSpriteCard(card({ symbol: '◇' })).symbol, '◇')
	assert.equal(validateSpriteCard(card({ symbol: '九尾' })).symbol, '九尾')
	throwsCode(() => validateSpriteCard(card({ symbol: '' })), 'SPRITE_CARD_INVALID')
	throwsCode(() => validateSpriteCard(card({ symbol: 'abcd' })), 'SPRITE_CARD_INVALID')
})

test('card text walks the same link wall as a note under a tree', () => {
	throwsCode(
		() => validateSpriteCard(card({ essence: 'find me at example.com' })),
		'SPRITE_CARD_INVALID'
	)
	throwsCode(() => validateSpriteCard(card({ name: 'https://x.io' })), 'SPRITE_CARD_INVALID')
})

test('invisible payload in a public label is refused', () => {
	throwsCode(() => validateSpriteCard(card({ name: '​secret' })), 'SPRITE_CARD_INVALID')
	throwsCode(() => validateSpriteCard(card({ symbol: '‮' })), 'SPRITE_CARD_INVALID')
})

test('altText is required — the card is the accessibility layer', () => {
	throwsCode(() => validateSpriteCard(card({ altText: '' })), 'SPRITE_CARD_INVALID')
	const { altText, ...withoutAlt } = card()
	void altText
	throwsCode(() => validateSpriteCard(withoutAlt), 'SPRITE_CARD_INVALID')
})

test('aura must be a pair of hex colours', () => {
	throwsCode(
		() => validateSpriteCard(card({ aura: { core: 'red', glow: '#fff' } })),
		'SPRITE_CARD_INVALID'
	)
	throwsCode(() => validateSpriteCard(card({ aura: { core: '#fff' } })), 'SPRITE_CARD_INVALID')
})

test('essence and altText have caps', () => {
	throwsCode(() => validateSpriteCard(card({ essence: 'x'.repeat(61) })), 'SPRITE_CARD_INVALID')
	throwsCode(() => validateSpriteCard(card({ altText: 'x'.repeat(121) })), 'SPRITE_CARD_INVALID')
	throwsCode(() => validateSpriteCard(card({ name: 'x'.repeat(17) })), 'SPRITE_CARD_INVALID')
})

// ---------------------------------------------------------------------------
// 存在 = f(row, now) — TD-S2

function presence(overrides = {}) {
	return {
		epoch: 1,
		placeKind: 'grove',
		placeXid: 'lin',
		committed: true,
		issuedAt: NOON,
		activeAt: NOON + SPRITE_CONDENSE_MS,
		expiresAt: NOON + SPRITE_VISIT_MS,
		endedAt: null,
		...overrides
	}
}

test('no row means sleeping', () => {
	assert.equal(presenceState(null, NOON).state, 'sleeping')
	assert.equal(presenceState(undefined, NOON).state, 'sleeping')
	assert.equal(presenceState(null, NOON).place, null)
})

test('the 42 seconds of condensation read as arriving, then active', () => {
	const row = presence()
	assert.equal(presenceState(row, NOON).state, 'arriving')
	assert.equal(presenceState(row, NOON + SPRITE_CONDENSE_MS - 1).state, 'arriving')
	assert.equal(presenceState(row, NOON + SPRITE_CONDENSE_MS).state, 'active')
	assert.equal(presenceState(row, NOON + SPRITE_VISIT_MS - 1).state, 'active')
})

test('an expired lease is already asleep — nothing had to run', () => {
	const row = presence()
	assert.equal(presenceState(row, NOON + SPRITE_VISIT_MS).state, 'sleeping')
	assert.equal(presenceState(row, NOON + SPRITE_VISIT_MS + DAY).state, 'sleeping')
})

// ---------------------------------------------------------------------------
// 做客到点回家，醒着 (§5.2). `presenceState` reads a lease; `homecomingLease`
// says what the NEXT one is. SpriteDO writes the handover before it reads.

test('a visit that ran out hands over to a home lease, awake until the day turns', () => {
	const ended = NOON + SPRITE_VISIT_MS
	const lease = homecomingLease(presence(), ended)
	assert.ok(lease)
	// The way home is a journey like any other: it condenses at the nest.
	assert.equal(lease.issuedAt, ended)
	assert.equal(lease.activeAt, ended + SPRITE_CONDENSE_MS)
	// Awake at home until the day boundary — never a second 42 minutes.
	assert.equal(lease.expiresAt, homeLeaseExpiry(ended))
	assert.equal(
		presenceState(
			{ ...presence(), ...lease, placeKind: 'home', placeXid: 'yan' },
			ended + SPRITE_CONDENSE_MS
		).state,
		'active'
	)
})

test('the homecoming is a function of the row, not of when anyone looks', () => {
	const row = presence()
	const early = homecomingLease(row, NOON + SPRITE_VISIT_MS)
	const late = homecomingLease(row, NOON + SPRITE_VISIT_MS + 3_600_000)
	assert.deepEqual(early, late)
})

test('the day boundary is still the one thing that puts it to sleep', () => {
	const row = presence()
	assert.equal(homecomingLease(row, homeLeaseExpiry(NOON + SPRITE_VISIT_MS)), null)
	assert.equal(homecomingLease(row, NOON + SPRITE_VISIT_MS + DAY), null)
})

test('being sent home is not coming home: an ended lease hands over nothing', () => {
	// 被请离 / the owner's brake / a compensated saga all write `endedAt`.
	assert.equal(homecomingLease(presence({ endedAt: NOON + 60_000 }), NOON + SPRITE_VISIT_MS), null)
	// It never arrived, so it cannot return.
	assert.equal(homecomingLease(presence({ committed: false }), NOON + SPRITE_VISIT_MS), null)
	// A night at home ends at the boundary and does not renew itself.
	assert.equal(
		homecomingLease(
			presence({ placeKind: 'home', placeXid: 'yan', expiresAt: NOON + SPRITE_VISIT_MS }),
			NOON + SPRITE_VISIT_MS
		),
		null
	)
	// Still out.
	assert.equal(homecomingLease(presence(), NOON + SPRITE_VISIT_MS - 1), null)
})

test('a visit ending near the boundary still buys the floor, never nothing', () => {
	// 42 minutes out, ending 10 minutes before midnight: the way back would
	// otherwise finish condensing into sleep.
	const start = Date.UTC(2026, 6, 26, 23, 28)
	const lease = homecomingLease(
		presence({ expiresAt: start + SPRITE_VISIT_MS }),
		start + SPRITE_VISIT_MS
	)
	assert.ok(lease)
	assert.ok(lease.expiresAt - lease.activeAt > 0)
	assert.equal(lease.expiresAt, homeLeaseExpiry(start + SPRITE_VISIT_MS))
})

// ---------------------------------------------------------------------------
// 常驻醒来令 (§5.5). A mind says one thing that outlives its session; the world
// settles it by reading, the same way it settles a homecoming.

/** Yesterday, so an order placed then speaks for today. */
const YESTERDAY = NOON - DAY

function order(overrides = {}) {
	return { by: 'agt_mind', placedAt: YESTERDAY, seenAt: YESTERDAY, ...overrides }
}

test('a standing order wakes it at home, dated to the day rather than to the look', () => {
	const dayStart = Math.floor(NOON / DAY) * DAY
	const lease = standingWakeLease(null, order(), NOON)
	assert.ok(lease)
	assert.equal(lease.issuedAt, dayStart)
	assert.equal(lease.activeAt, dayStart + SPRITE_CONDENSE_MS)
	assert.equal(lease.expiresAt, homeLeaseExpiry(dayStart))
	// Nothing the reader did caused this: whoever looks first, and whenever in
	// the day they look, materializes exactly the same row.
	assert.deepEqual(standingWakeLease(null, order(), NOON + 5 * 3_600_000), lease)
	assert.equal(
		presenceState({ ...presence(), ...lease, placeKind: 'home', placeXid: 'yan' }, NOON).state,
		'active'
	)
})

test('an order placed today did today’s waking when it was placed', () => {
	const dayStart = Math.floor(NOON / DAY) * DAY
	assert.equal(standingWakeLease(null, order({ placedAt: dayStart }), NOON), null)
	assert.equal(standingWakeLease(null, order({ placedAt: NOON - 60_000 }), NOON), null)
	// And tomorrow it speaks.
	assert.ok(standingWakeLease(null, order({ placedAt: dayStart }), NOON + DAY))
})

test('the brake wins the day it was pressed', () => {
	// 结束过的租约不交接任何东西 — the same line homecomingLease draws. The owner
	// (or a dismissal, or a compensated saga) ended this day; an order left
	// yesterday is not a way to overrule them until tomorrow.
	const braked = presence({ placeKind: 'home', placeXid: 'yan', endedAt: NOON - 60_000 })
	assert.equal(standingWakeLease(braked, order(), NOON), null)
	// Tomorrow, though, it wakes again: the brake stopped a day, not a standing
	// order — ending that one is its own act.
	assert.ok(standingWakeLease(braked, order(), NOON + DAY))
})

test('an order never wakes what is already awake or on its way', () => {
	assert.equal(standingWakeLease(presence(), order(), NOON), null)
	assert.equal(standingWakeLease(presence(), order(), NOON + SPRITE_CONDENSE_MS), null)
	// A lease that has run out is asleep, and that one it does wake.
	assert.ok(standingWakeLease(presence(), order(), NOON + SPRITE_VISIT_MS + 1000))
})

test('an order lapses when no mind has come back for a month', () => {
	const aged = (age) => order({ placedAt: NOON - age, seenAt: NOON - age })
	assert.ok(standingWakeLease(null, aged(SPRITE_STANDING_TTL_MS), NOON))
	assert.equal(standingWakeLease(null, aged(SPRITE_STANDING_TTL_MS + 1), NOON), null)
	// `seenAt` is what keeps it alive, so an old order a mind still drives stands.
	assert.ok(
		standingWakeLease(
			null,
			order({ placedAt: NOON - 10 * SPRITE_STANDING_TTL_MS, seenAt: NOON - DAY }),
			NOON
		)
	)
	assert.equal(standingWakeLease(null, null, NOON), null)
})

test('a dismissed sprite is asleep even inside its lease', () => {
	const row = presence({ endedAt: NOON + 60_000 })
	assert.equal(presenceState(row, NOON + 120_000).state, 'sleeping')
})

test('an uncommitted row never reads as active, and self-heals', () => {
	const row = presence({ committed: false })
	// In flight: it holds a seat but cannot act.
	assert.equal(presenceState(row, NOON + SPRITE_CONDENSE_MS + 1000).state, 'arriving')
	// Past the reclaim window it is a crashed saga, not a sprite.
	assert.equal(presenceState(row, NOON + SPRITE_SAGA_RECLAIM_MS + 1).state, 'sleeping')
})

test('the action gate refuses sleeping, arriving and elsewhere', () => {
	const arriving = presenceState(presence(), NOON)
	const active = presenceState(presence(), NOON + SPRITE_CONDENSE_MS)
	assert.deepEqual(actionGate(active, 'lin'), { ok: true })
	assert.deepEqual(actionGate(active, 'ming'), { ok: false, reason: 'elsewhere' })
	assert.deepEqual(actionGate(arriving, 'lin'), { ok: false, reason: 'arriving' })
	assert.deepEqual(actionGate(presenceState(null, NOON), 'lin'), { ok: false, reason: 'sleeping' })
})

test('the nest badge never leaks a destination', () => {
	const away = presenceState(presence(), NOON + SPRITE_CONDENSE_MS)
	assert.equal(nestStateOf(true, away, 'yan'), 'away')
	const home = presenceState(
		presence({ placeKind: 'home', placeXid: 'yan' }),
		NOON + SPRITE_CONDENSE_MS
	)
	assert.equal(nestStateOf(true, home, 'yan'), 'awake')
	assert.equal(nestStateOf(true, presenceState(null, NOON), 'yan'), 'sleeping')
	assert.equal(nestStateOf(false, presenceState(null, NOON), 'yan'), 'none')
})

// ---------------------------------------------------------------------------
// 容量与一道门 (§6.1/§6.2)

// The tree-count semantics and the «0 trees is not «full»» rule live in the
// WP-S7 block at the bottom of this file; what is asserted here is only that a
// visiting light never displaces the owner's own, whatever the number is.
test('the owner nest never counts against the grove’s own capacity', () => {
	assert.equal(visitorCapacity(4), 4)
})

test('a full grove says full, and only counts live rows', () => {
	const today = Math.floor(NOON / DAY)
	const rows = [1, 2, 3, 4].map((n) => ({
		spriteOwnerId: `guest${n}`,
		expiresAt: NOON + SPRITE_VISIT_MS,
		utcDay: today
	}))
	assert.equal(admitVerdict(rows, 'yan', 4, NOON), 'full')
	// One lease has run out: the seat is free the moment anyone looks.
	rows[0].expiresAt = NOON - 1
	assert.equal(admitVerdict(rows, 'yan', 4, NOON), 'ok')
})

test('one grove hosts one sprite once per day', () => {
	const today = Math.floor(NOON / DAY)
	const rows = [{ spriteOwnerId: 'yan', expiresAt: NOON - 1, utcDay: today }]
	assert.equal(admitVerdict(rows, 'yan', 4, NOON), 'already_today')
	// Tomorrow the same sprite is welcome again.
	assert.equal(admitVerdict(rows, 'yan', 4, NOON + DAY), 'ok')
})

// ---------------------------------------------------------------------------
// 经历 (§9.1)

test('milestones are earned once ever, with deterministic ids', () => {
	const earned = new Set()
	const first = deriveExperiences('wake', { earned, occurredAt: NOON })
	assert.deepEqual(
		first.map((e) => e.type),
		['first_wake']
	)
	assert.equal(first[0].id, spriteExperienceId('first_wake'))
	earned.add('first_wake')
	assert.deepEqual(deriveExperiences('wake', { earned, occurredAt: NOON + 1 }), [])
})

test('going out earns the first wake too', () => {
	const out = deriveExperiences('arrive_away', {
		earned: [],
		occurredAt: NOON,
		placeXid: 'lin',
		distinctGrovesVisited: 1
	})
	assert.deepEqual(
		out.map((e) => e.type),
		['first_wake', 'first_outing']
	)
	assert.equal(out[1].placeXid, 'lin')
})

test('the seventh grove is a milestone', () => {
	const earned = ['first_wake', 'first_outing']
	assert.deepEqual(
		deriveExperiences('arrive_away', {
			earned,
			occurredAt: NOON,
			distinctGrovesVisited: SPRITE_GROVES_VISITED_MILESTONE - 1
		}),
		[]
	)
	const out = deriveExperiences('arrive_away', {
		earned,
		occurredAt: NOON,
		distinctGrovesVisited: SPRITE_GROVES_VISITED_MILESTONE
	})
	assert.deepEqual(
		out.map((e) => e.type),
		['groves_visited_7']
	)
})

test('every milestone event has a type', () => {
	for (const [event, type] of [
		['born', 'born'],
		['water_away', 'first_water_away'],
		['message', 'first_message'],
		['gift', 'first_gift'],
		['meet', 'first_meeting']
	]) {
		const out = deriveExperiences(event, { earned: [], occurredAt: NOON })
		assert.deepEqual(
			out.map((e) => e.type),
			[type]
		)
	}
})

// ---------------------------------------------------------------------------
// 行动日志 (§9.3)

test('a journal entry is structured, never free text', () => {
	const entry = journalEntry({
		at: NOON,
		placeXid: 'lin',
		kind: 'water',
		ref: 'tree_1',
		cost: { dew: 1 },
		driver: 'agt_x'
	})
	assert.deepEqual(entry, {
		at: NOON,
		placeXid: 'lin',
		kind: 'water',
		ref: 'tree_1',
		cost: { dew: 1 },
		driver: 'agt_x',
		result: 'ok'
	})
	assert.equal(journalEntry({ at: NOON, kind: 'home', driver: 'owner', cost: {} }).cost, null)
})

test('the journal is a rolling window, not an archive', () => {
	assert.equal(journalPruneBefore(NOON), NOON - SPRITE_JOURNAL_RETENTION_MS)
	assert.equal(SPRITE_JOURNAL_RETENTION_MS, 7 * DAY)
})

// ---------------------------------------------------------------------------
// L2 预算 (TD-S6)

test('budgets come from the owner ledger and reset with the UTC day', () => {
	const today = Math.floor(NOON / DAY)
	const view = spriteBudgetView({ utcDay: today, messagesSent: 2, giftsSent: 3 }, NOON)
	assert.equal(view.messagesRemaining, SPRITE_MSG_PER_DAY - 2)
	assert.equal(view.giftsRemaining, 0)
	assert.equal(hasBudget(view, 'message'), true)
	assert.equal(hasBudget(view, 'gift'), false)
	// Yesterday's counters are not today's counters.
	const stale = spriteBudgetView({ utcDay: today - 1, messagesSent: 3, giftsSent: 3 }, NOON)
	assert.equal(stale.messagesRemaining, SPRITE_MSG_PER_DAY)
	assert.equal(stale.giftsRemaining, SPRITE_GIFTS_PER_DAY)
	assert.equal(spriteBudgetView(null, NOON).messagesRemaining, SPRITE_MSG_PER_DAY)
})

test('one note per grove per day is decided at the target', () => {
	assert.equal(canLeaveNoteHere(0), true)
	assert.equal(canLeaveNoteHere(1), false)
})

// ---------------------------------------------------------------------------
// 形态版本与确认 (§4.3)

test('birth and a rename always need the owner; ordinary looks can be delegated', () => {
	const base = { status: 'alive', autoFormUpdate: true, previousName: '小九', nextName: '小九' }
	assert.equal(formNeedsConfirmation(base), false)
	assert.equal(formNeedsConfirmation({ ...base, autoFormUpdate: false }), true)
	assert.equal(formNeedsConfirmation({ ...base, nextName: '大九' }), true)
	assert.equal(formNeedsConfirmation({ ...base, status: 'unborn' }), true)
})

test('the three switches default the way the product says', () => {
	assert.deepEqual(DEFAULT_SPRITE_SETTINGS, {
		autoFormUpdate: false,
		allowMessages: true,
		allowGift: false
	})
})

test('poses are a closed set', () => {
	assert.equal(isSpritePose('wave'), true)
	assert.equal(isSpritePose('dance'), false)
})

// ---------------------------------------------------------------------------
// 消毒器：真实身体回归 (WP-S0 corpus)
//
// These eleven bodies were generated by agents against the §4.2 constraints and
// signed off in the WP-S0 prototype. If a change to the sanitizer rejects one of
// them, the sanitizer is wrong until proven otherwise.

function wrap(body, vb) {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb[0]} ${vb[1]}">${body}</svg>`
}

test('every WP-S0 body survives the sanitizer', () => {
	for (const body of BODIES) {
		const out = sanitizeSpriteBody(wrap(body.svg, body.vb))
		assert.ok(out.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), body.id)
		assert.ok(
			out.nodeCount > 0 && out.nodeCount <= SPRITE_BODY_MAX_NODES,
			`${body.id}: ${out.nodeCount}`
		)
		assert.ok(out.byteLength <= SPRITE_BODY_MAX_BYTES, `${body.id}: ${out.byteLength}`)
		assert.deepEqual([...out.viewBox], [0, 0, body.vb[0], body.vb[1]], body.id)
	}
})

test('the two caps are calibrated against the validated «满上限» sample', () => {
	// The heaviest body the designer signed off in WP-S0 is the reference point
	// for both caps: it must pass with headroom, and it must genuinely sit near
	// the node cap (otherwise the cap was never exercised at all).
	const heaviest = BODIES.map((b) => sanitizeSpriteBody(wrap(b.svg, b.vb))).reduce((a, b) =>
		b.nodeCount > a.nodeCount ? b : a
	)
	assert.ok(heaviest.nodeCount > SPRITE_BODY_MAX_NODES * 0.9, `only ${heaviest.nodeCount} nodes`)
	assert.ok(heaviest.byteLength < SPRITE_BODY_MAX_BYTES, `${heaviest.byteLength} bytes`)
	// Headroom, so an ordinary body at the node cap is not rejected on bytes:
	// the caps must not contradict each other at the density that ships.
	const bytesPerNode = heaviest.byteLength / heaviest.nodeCount
	assert.ok(
		bytesPerNode * SPRITE_BODY_MAX_NODES <= SPRITE_BODY_MAX_BYTES,
		`at ${bytesPerNode.toFixed(1)} bytes/node the node cap is unreachable`
	)
})

test('the served root always carries explicit pixel size (the satori lesson)', () => {
	const out = sanitizeSpriteBody(wrap('<circle cx="10" cy="10" r="5" fill="#123456"/>', [40, 60]))
	assert.match(out.svg, /width="40"/)
	assert.match(out.svg, /height="60"/)
})

test('an author width/height is replaced, not trusted', () => {
	const out = sanitizeSpriteBody(
		'<svg viewBox="0 0 40 60" width="9999" height="1"><circle cx="10" cy="10" r="5" fill="#123456"/></svg>'
	)
	assert.match(out.svg, /width="40" height="60"/)
	assert.equal(out.svg.includes('9999'), false)
})

test('the reduced-motion switch is injected, always', () => {
	const out = sanitizeSpriteBody(
		wrap('<rect x="0" y="0" width="4" height="4" fill="#111111"/>', [10, 10])
	)
	assert.ok(out.svg.includes('@media (prefers-reduced-motion:reduce)'))
	assert.ok(out.svg.includes('animation:none!important'))
})

test('sanitizing is deterministic — same bytes in, same bytes out', () => {
	const svg = wrap('<circle cx="5" cy="5" r="4" fill="#abcdef"/>', [10, 10])
	assert.equal(sanitizeSpriteBody(svg).svg, sanitizeSpriteBody(sanitizeSpriteBody(svg).svg).svg)
})

test('the body hash is the address', async () => {
	const a = sanitizeSpriteBody(wrap('<circle cx="5" cy="5" r="4" fill="#abcdef"/>', [10, 10])).svg
	const b = sanitizeSpriteBody(wrap('<circle cx="5" cy="5" r="4" fill="#abcdee"/>', [10, 10])).svg
	const [ha, hb] = await Promise.all([spriteBodyHash(a), spriteBodyHash(b)])
	assert.match(ha, /^[0-9a-f]{32}$/)
	assert.notEqual(ha, hb)
	assert.equal(ha, await spriteBodyHash(a))
})

// ---------------------------------------------------------------------------
// 消毒器：恶意样本集
//
// Each case is a real attack shape, not a syntax quibble. A regression here is
// a security regression.

const MALICIOUS = [
	[
		'inline script',
		'<svg viewBox="0 0 10 10"><script>alert(1)</script><circle r="1" fill="#111111"/></svg>'
	],
	[
		'event handler',
		'<svg viewBox="0 0 10 10"><circle r="1" fill="#111111" onload="alert(1)"/></svg>'
	],
	[
		'event handler in odd case',
		'<svg viewBox="0 0 10 10"><circle r="1" fill="#111111" OnLoad="alert(1)"/></svg>'
	],
	[
		'external image',
		'<svg viewBox="0 0 10 10"><image href="https://evil.example/x.png"/><circle r="1" fill="#111111"/></svg>'
	],
	[
		'xlink href',
		'<svg viewBox="0 0 10 10"><circle r="1" fill="#111111" xlink:href="https://evil.example"/></svg>'
	],
	[
		'foreignObject html',
		'<svg viewBox="0 0 10 10"><foreignObject><div>hi</div></foreignObject><circle r="1" fill="#111111"/></svg>'
	],
	[
		'entity bomb',
		'<!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><svg viewBox="0 0 10 10"><circle r="1" fill="&b;"/></svg>'
	],
	[
		'numeric character reference smuggling',
		'<svg viewBox="0 0 10 10"><circle r="1" fill="&#106;avascript:alert(1)"/></svg>'
	],
	[
		'css import',
		'<svg viewBox="0 0 10 10"><style>@import url(https://evil.example/x.css);</style><circle r="1" fill="#111111"/></svg>'
	],
	[
		'css font-face',
		'<svg viewBox="0 0 10 10"><style>@font-face{src:url(https://evil.example/f.woff)}</style><circle r="1" fill="#111111"/></svg>'
	],
	[
		'external url in fill',
		'<svg viewBox="0 0 10 10"><circle r="1" fill="url(https://evil.example/x#a)"/></svg>'
	],
	['dangling reference', '<svg viewBox="0 0 10 10"><circle r="1" fill="url(#nope)"/></svg>'],
	[
		'text element',
		'<svg viewBox="0 0 10 10"><text x="0" y="5">buy now</text><circle r="1" fill="#111111"/></svg>'
	],
	['loose text content', '<svg viewBox="0 0 10 10">buy now<circle r="1" fill="#111111"/></svg>'],
	[
		'SMIL animate',
		'<svg viewBox="0 0 10 10"><circle r="1" fill="#111111"><animate attributeName="r" to="5" dur="1s"/></circle></svg>'
	],
	[
		'SMIL set',
		'<svg viewBox="0 0 10 10"><circle r="1" fill="#111111"><set attributeName="fill" to="#fff"/></circle></svg>'
	],
	[
		'use element (expansion bomb shape)',
		'<svg viewBox="0 0 10 10"><defs><g id="a"><circle r="1" fill="#111111"/></g></defs><use href="#a"/></svg>'
	],
	[
		'filter DoS',
		'<svg viewBox="0 0 10 10"><filter id="f"><feGaussianBlur stdDeviation="9999"/></filter><circle r="1" fill="#111111" filter="url(#f)"/></svg>'
	],
	['no viewBox', '<svg width="10" height="10"><circle r="1" fill="#111111"/></svg>'],
	['nothing is drawn', '<svg viewBox="0 0 10 10"><defs></defs></svg>'],
	[
		'invisible at rest — opacity 0',
		'<svg viewBox="0 0 10 10"><circle r="1" fill="#111111" opacity="0"/></svg>'
	],
	[
		'invisible at rest — css opacity 0',
		'<svg viewBox="0 0 10 10"><style>.a{opacity:0;animation:x 1s}@keyframes x{to{opacity:1}}</style><circle class="a" r="1" fill="#111111"/></svg>'
	],
	[
		'invisible at rest — scale(0)',
		'<svg viewBox="0 0 10 10"><style>.a{transform:scale(0)}</style><circle class="a" r="1" fill="#111111"/></svg>'
	],
	[
		'display none',
		'<svg viewBox="0 0 10 10"><style>.a{display:none}</style><circle class="a" r="1" fill="#111111"/></svg>'
	],
	[
		'named colour (not self-contained on both themes)',
		'<svg viewBox="0 0 10 10"><circle r="1" fill="red"/></svg>'
	],
	['currentColor', '<svg viewBox="0 0 10 10"><circle r="1" fill="currentColor"/></svg>'],
	[
		'css variable',
		'<svg viewBox="0 0 10 10"><style>.a{--x:1;fill:#111111}</style><circle class="a" r="1"/></svg>'
	],
	[
		'media query (theme-dependent body)',
		'<svg viewBox="0 0 10 10"><style>@media (prefers-color-scheme:dark){.a{fill:#fff}}</style><circle class="a" r="1" fill="#111111"/></svg>'
	],
	[
		'animation without keyframes',
		'<svg viewBox="0 0 10 10"><style>.a{animation:ghost 1s}</style><circle class="a" r="1" fill="#111111"/></svg>'
	],
	['unquoted attribute', '<svg viewBox="0 0 10 10"><circle r=1 fill="#111111"/></svg>'],
	['mismatched tags', '<svg viewBox="0 0 10 10"><g><circle r="1" fill="#111111"/></svg>'],
	[
		'two roots',
		'<svg viewBox="0 0 10 10"><circle r="1" fill="#111111"/></svg><svg viewBox="0 0 1 1"></svg>'
	],
	[
		'absurd geometry',
		'<svg viewBox="0 0 10 10"><rect x="0" y="0" width="99999999" height="99999999" fill="#111111"/></svg>'
	],
	[
		'pseudo-class selector',
		'<svg viewBox="0 0 10 10"><style>.a:hover{fill:#222222}</style><circle class="a" r="1" fill="#111111"/></svg>'
	],
	[
		'!important override',
		'<svg viewBox="0 0 10 10"><style>.a{animation:x 1s !important}@keyframes x{to{opacity:.9}}</style><circle class="a" r="1" fill="#111111"/></svg>'
	]
]

for (const [name, svg] of MALICIOUS) {
	test(`sanitizer rejects: ${name}`, () => {
		throwsCode(() => sanitizeSpriteBody(svg), 'SPRITE_BODY_INVALID')
	})
}

test('deep nesting is refused', () => {
	const depth = 40
	const open = '<g>'.repeat(depth)
	const close = '</g>'.repeat(depth)
	throwsCode(
		() =>
			sanitizeSpriteBody(
				`<svg viewBox="0 0 10 10">${open}<circle r="1" fill="#111111"/>${close}</svg>`
			),
		'SPRITE_BODY_INVALID'
	)
})

test('too many nodes is refused', () => {
	const shapes = '<circle r="1" fill="#111111"/>'.repeat(SPRITE_BODY_MAX_NODES + 10)
	throwsCode(
		() => sanitizeSpriteBody(`<svg viewBox="0 0 10 10">${shapes}</svg>`),
		'SPRITE_BODY_INVALID'
	)
})

test('an oversized body is refused before it is parsed', () => {
	const filler = '<circle r="1" fill="#111111"/>'
	const huge = `<svg viewBox="0 0 10 10">${filler.repeat(20_000)}</svg>`
	throwsCode(() => sanitizeSpriteBody(huge), 'SPRITE_BODY_INVALID')
})

test('empty input is refused', () => {
	throwsCode(() => sanitizeSpriteBody(''), 'SPRITE_BODY_INVALID')
	throwsCode(() => sanitizeSpriteBody('   '), 'SPRITE_BODY_INVALID')
})

// ---------------------------------------------------------------------------
// 消毒器：合法输入不该被误杀

test('gradients, clip paths and CSS animation are all legitimate', () => {
	const svg = `<svg viewBox="0 0 100 100">
		<defs>
			<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stop-color="#E8A33D"/>
				<stop offset="100%" stop-color="#F6DCA8" stop-opacity=".8"/>
			</linearGradient>
			<clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath>
		</defs>
		<style>.b{animation:sway 5s ease-in-out infinite;transform-origin:50px 50px}@keyframes sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}</style>
		<g class="b" clip-path="url(#c)">
			<rect x="10" y="10" width="80" height="80" fill="url(#g)" stroke="rgba(13,19,33,.4)" stroke-width="2"/>
			<path d="M10 90 C 30 60 70 60 90 90 Z" fill="#4F7D4C" stroke-linecap="round"/>
		</g>
	</svg>`
	const out = sanitizeSpriteBody(svg)
	assert.equal(out.animated, true)
	assert.ok(out.svg.includes('@keyframes sway'))
	assert.ok(out.svg.includes('url(#g)'))
})

test('a still body is still a body', () => {
	const out = sanitizeSpriteBody(wrap('<circle cx="5" cy="5" r="4" fill="#abcdef"/>', [10, 10]))
	assert.equal(out.animated, false)
})

test('comments and xml declarations are dropped, not rejected', () => {
	const out = sanitizeSpriteBody(
		'<?xml version="1.0"?><!-- painted by an agent --><svg viewBox="0 0 10 10"><circle r="1" fill="#111111"/></svg>'
	)
	assert.equal(out.svg.includes('<!--'), false)
	assert.equal(out.svg.includes('<?xml'), false)
})

// ---------------------------------------------------------------------------
// 新账号首日出门上限 (WP-S6, devplan §7)

test('an account’s age is readable from its own xid', () => {
	// A known xid from the format's own documentation: minted 2011-03-22.
	assert.equal(xidCreatedAt('9m4e2mr0ui3e8a215n4g'), 1_300_816_219_000)
	assert.equal(xidCreatedAt('not-an-xid'), null)
	assert.equal(xidCreatedAt(''), null)
})

test('the first-day outing cap lifts itself with a day of age', () => {
	const born = 1_800_000_000_000
	assert.equal(spriteFirstDayVisitCap(born, born), SPRITE_FIRST_DAY_VISITS)
	assert.equal(spriteFirstDayVisitCap(born, born + 86_399_000), SPRITE_FIRST_DAY_VISITS)
	assert.equal(spriteFirstDayVisitCap(born, born + 86_400_000), null)
	// Nobody picks their own userId, so an unreadable one is our own legacy data
	// and must not cap a real account forever.
	assert.equal(spriteFirstDayVisitCap(null, born), null)
})

// ---------------------------------------------------------------------------
// 林子的两道门槛与一棵树一束光 (WP-S7)

test('出生 asks for one tree the owner planted themselves', () => {
	assert.equal(birthGate({ ownTrees: 0, doorOpen: true, guestPlanterXid: null }).ok, false)
	assert.equal(birthGate({ ownTrees: 1, doorOpen: false, guestPlanterXid: null }).ok, true)
})

test('第一次出门 asks the owner to open their own door, and only once', () => {
	const shut = { ownTrees: 1, doorOpen: false, guestPlanterXid: null }
	const open = { ownTrees: 1, doorOpen: true, guestPlanterXid: null }
	assert.equal(firstOutingGate(shut, false).ok, false)
	assert.equal(firstOutingGate(open, false).ok, true)
	// Once it has been out, the door is never asked about again: closing it later
	// is a hosting decision, not a leash on a sprite that already travels.
	assert.equal(firstOutingGate(shut, true).ok, true)
})

test('一棵树，一束光: capacity is what the grove grew, and none is not «full»', () => {
	const seats = (n) =>
		Array.from({ length: n }, (_, i) => ({
			spriteOwnerId: `guest-${i}`,
			expiresAt: 2_000,
			utcDay: 0
		}))
	assert.equal(visitorCapacity(0), 0)
	assert.equal(visitorCapacity(3), 3)
	// A bare grove says so in its own word — «come back later» would be a lie.
	assert.equal(admitVerdict([], 'me', 0, 1_000), 'no_trees')
	assert.equal(admitVerdict(seats(1), 'me', 2, 1_000), 'ok')
	assert.equal(admitVerdict(seats(2), 'me', 2, 1_000), 'full')
	// Expired seats were never there: capacity is read, never swept.
	assert.equal(admitVerdict(seats(2), 'me', 2, 3_000), 'ok')
})
