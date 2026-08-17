import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
	AlinkCoreError,
	DAILY_DEW,
	DEFAULT_GROVE_SETTINGS,
	DEW_FROM_FRUIT_DAILY_CAP,
	FIRST_TREE_FIRST_LEAF_MS,
	FIRST_TREE_STAGE_MS,
	GROVE_DEPARTED_USER,
	GROVE_EPOCH_MS,
	GROVE_FACT_COUNT,
	GROVE_GUEST_PLOT_INDEX,
	GROVE_MESSAGE_MAX_LENGTH,
	GROVE_OWNER_PLOTS,
	GROVE_SPECIES,
	GROVE_SPECIES_IDS,
	GROVE_STARTER_SPECIES,
	GROVE_YEAR_MS,
	WELCOME_FRUIT_ROUND,
	WELCOME_FRUIT_TTL_MS,
	applyFruitDew,
	dailyDewFor,
	assertGuestRequestTransition,
	canPickFruit,
	canTransitionFruit,
	canTransitionGroveMessage,
	canTransitionGuestRequest,
	canTransitionSeed,
	canTransitionTrayFruit,
	computeTreeState,
	groveMonthOf,
	groveMonthStartMs,
	groveYearOf,
	growthMilestonesBetween,
	hasSprouting,
	isReservedHandle,
	isValidXid,
	morphSeedOf,
	normalizeGroveMessage,
	plotTypeOf,
	resolveDewLedger,
	resolveShake,
	rollFruitBatch,
	seasonOf,
	simulateSpeciesYear,
	spectacleOf,
	speciesOf,
	stageOf,
	utcDayOf,
	treeSizeOf,
	validateSpeciesDef,
	waterEffectIndex,
	weatherOf,
	welcomeCropExpiryMs,
	welcomeFlourishKind,
	wildWindSpeciesFor,
	windBlowsFor
} from '../src/index.js'

const DAY = 86_400_000
const HOUR = 3_600_000

// ---------------------------------------------------------------------------
// Clocks (product §4.1: 12× season clock, per-species life clock)

test('grove year runs at exactly 12x real time', () => {
	assert.equal(GROVE_YEAR_MS, Math.round((365.2425 * DAY) / 12))
	// One real year holds twelve natural years.
	const realYear = 365.2425 * DAY
	assert.equal(Math.round(realYear / GROVE_YEAR_MS), 12)
})

test('natural months and seasons cycle deterministically from the epoch', () => {
	assert.equal(groveMonthOf(GROVE_EPOCH_MS), 1)
	assert.equal(seasonOf(GROVE_EPOCH_MS), 'winter')
	// Month starts round-trip through groveMonthOf.
	for (let month = 1; month <= 12; month += 1) {
		assert.equal(groveMonthOf(groveMonthStartMs(40, month) + 1), month)
	}
	// A full grove year sweeps all four seasons.
	const seen = new Set()
	for (let step = 0; step < 48; step += 1) {
		seen.add(seasonOf(GROVE_EPOCH_MS + Math.floor((step / 48) * GROVE_YEAR_MS)))
	}
	assert.deepEqual([...seen].sort(), ['autumn', 'spring', 'summer', 'winter'])
	// Season mapping: month 4 = spring, 7 = summer, 10 = autumn, 1 = winter.
	assert.equal(seasonOf(groveMonthStartMs(40, 4) + 1), 'spring')
	assert.equal(seasonOf(groveMonthStartMs(40, 7) + 1), 'summer')
	assert.equal(seasonOf(groveMonthStartMs(40, 10) + 1), 'autumn')
	assert.equal(groveYearOf(groveMonthStartMs(40, 1) + 1), 40)
})

test('a tree measures itself on the season clock: height plateaus, girth does not', () => {
	const apple = speciesOf('apple')
	const redwood = speciesOf('redwood')
	// A seed has nothing above ground to measure.
	assert.deepEqual(treeSizeOf(apple, 0, 'seed'), { heightCm: 0, girthCm: 0 })
	// Day one is a sprout you could hold in one hand; two real weeks (the
	// apple's maturity) is a small tree that can plausibly carry fruit.
	assert.equal(treeSizeOf(apple, DAY, 'sprout').heightCm, 10)
	const atMaturity = treeSizeOf(apple, 14 * DAY, 'mature')
	assert.ok(atMaturity.heightCm > 100 && atMaturity.heightCm < 200, `${atMaturity.heightCm}cm`)
	// Eight real years = 96 natural ones. Height has all but stopped; the trunk
	// is what says «century tree» — 190cm around for an apple, 5m for a redwood.
	const oldApple = treeSizeOf(apple, 2922 * DAY, 'mature')
	const olderApple = treeSizeOf(apple, 5844 * DAY, 'mature')
	assert.ok(oldApple.heightCm > 850 && oldApple.heightCm < 900, `${oldApple.heightCm}cm`)
	assert.ok(olderApple.heightCm - oldApple.heightCm < 30, 'height plateaus')
	assert.ok(olderApple.girthCm > oldApple.girthCm * 1.8, 'girth keeps going')
	const oldRedwood = treeSizeOf(redwood, 2922 * DAY, 'mature')
	assert.ok(oldRedwood.heightCm > 6000, `${oldRedwood.heightCm}cm`)
	assert.ok(oldRedwood.girthCm > 400, `${oldRedwood.girthCm}cm`)
	// The stage word and the number never contradict each other: the first tree
	// is a 幼树 within the hour (§7.2), and «young, 1cm tall» was exactly the
	// day-one grove calling its own picture a liar.
	const dayOne = treeSizeOf(apple, HOUR, 'young')
	assert.ok(dayOne.heightCm >= 80, `${dayOne.heightCm}cm`)
	assert.ok(treeSizeOf(redwood, 6 * HOUR, 'mature').heightCm >= 150)
	// Never zero, never backwards, for every species in the catalog.
	for (const id of GROVE_SPECIES_IDS) {
		const def = speciesOf(id)
		let last = 0
		for (const days of [1, 7, 30, 365, 2922]) {
			const size = treeSizeOf(def, days * DAY, 'young')
			assert.ok(size.heightCm >= last, `${id} height went backwards`)
			assert.ok(size.girthCm >= 1, `${id} girth under 1cm`)
			last = size.heightCm
		}
	}
})

test('computeTreeState carries the size the reader is shown', () => {
	const plantedAt = Date.UTC(2026, 6, 1)
	const state = computeTreeState({
		speciesId: 'apple',
		plantedAt,
		firstTree: false,
		now: plantedAt + 30 * DAY
	})
	assert.deepEqual(
		{ heightCm: state.heightCm, girthCm: state.girthCm },
		treeSizeOf(speciesOf('apple'), 30 * DAY, state.stage)
	)
})

test('stage boundaries are threshold-inclusive on the species clock', () => {
	const apple = speciesOf('apple')
	const plantedAt = Date.UTC(2026, 6, 1)
	assert.equal(stageOf(apple, plantedAt, plantedAt, false), 'seed')
	assert.equal(stageOf(apple, plantedAt, plantedAt + apple.stageMs.sprout - 1, false), 'seed')
	assert.equal(stageOf(apple, plantedAt, plantedAt + apple.stageMs.sprout, false), 'sprout')
	assert.equal(stageOf(apple, plantedAt, plantedAt + apple.stageMs.seedling, false), 'seedling')
	assert.equal(stageOf(apple, plantedAt, plantedAt + apple.stageMs.young, false), 'young')
	assert.equal(stageOf(apple, plantedAt, plantedAt + apple.stageMs.mature - 1, false), 'young')
	assert.equal(stageOf(apple, plantedAt, plantedAt + apple.stageMs.mature, false), 'mature')
})

// ---------------------------------------------------------------------------
// First-tree welcome show (§7.2 初生时间)

test('first tree walks the welcome timeline: 10s sprout, 5min seedling, 1h young, 6h mature', () => {
	const apple = speciesOf('apple')
	const plantedAt = Date.UTC(2026, 6, 1)
	assert.equal(stageOf(apple, plantedAt, plantedAt + 9_999, true), 'seed')
	assert.equal(stageOf(apple, plantedAt, plantedAt + 10_000, true), 'sprout')
	assert.equal(stageOf(apple, plantedAt, plantedAt + 300_000, true), 'seedling')
	assert.equal(stageOf(apple, plantedAt, plantedAt + HOUR, true), 'young')
	assert.equal(stageOf(apple, plantedAt, plantedAt + 6 * HOUR, true), 'mature')
})

test('welcome milestones include the first leaf and the flourish', () => {
	const plantedAt = Date.UTC(2026, 6, 1)
	const milestones = growthMilestonesBetween(
		{ speciesId: 'apple', plantedAt, firstTree: true },
		plantedAt,
		plantedAt + 6 * HOUR
	)
	const kinds = milestones.map((m) => m.kind)
	assert.deepEqual(kinds, [
		'sprouted',
		'first_leaf',
		'seedling',
		'young',
		'matured',
		'welcome_flourish'
	])
	assert.equal(milestones[1].at, plantedAt + FIRST_TREE_FIRST_LEAF_MS)
	assert.equal(milestones[5].flourish, 'bloom')
	assert.equal(milestones[5].at, plantedAt + FIRST_TREE_STAGE_MS.mature)
})

test('the sky wins: an open window IS the welcome show, never blossom over a crop', () => {
	// Natural month 10 — the apple fruit window is already open, so the tree
	// simply wears the season it was born into (§4.1 一次只穿一季).
	const plantedAt = groveMonthStartMs(40, 10)
	const now = plantedAt + 6 * HOUR + 1
	const state = computeTreeState({ speciesId: 'apple', plantedAt, firstTree: true, now })
	assert.equal(state.welcomeFlourish, 'fruit')
	assert.equal(state.fruiting, true)
	assert.equal(state.blooming, false, 'no blossom hangs on a fruiting tree')
	assert.equal(state.fruitRound, groveYearOf(now), 'the real round, not the welcome crop')
	assert.equal(state.visualSeason, state.season, 'nothing to stage — the sky is enough')
})

test('the welcome show of a tree maturing in season carries the real round', () => {
	const plantedAt = groveMonthStartMs(40, 10)
	const milestones = growthMilestonesBetween(
		{ speciesId: 'apple', plantedAt, firstTree: true },
		plantedAt,
		plantedAt + 7 * HOUR
	)
	const welcome = milestones.find((m) => m.kind === 'welcome_flourish')
	assert.equal(welcome.flourish, 'fruit')
	assert.equal(welcome.fruitRound, 40)
	assert.ok(
		!milestones.some((m) => m.kind === 'fruit_started'),
		'the season does not tell the same story twice'
	)
	assert.ok(!milestones.some((m) => m.kind === 'bloom_started'))
})

test('out of season the welcome show fast-forwards to the next window', () => {
	// Natural month 1: apple stands bare, and its next window is spring bloom.
	const winter = groveMonthStartMs(40, 1)
	const bloom = computeTreeState({
		speciesId: 'apple',
		plantedAt: winter,
		firstTree: true,
		now: winter + 6 * HOUR + 1
	})
	assert.equal(bloom.welcomeFlourish, 'bloom')
	assert.equal(bloom.blooming, true)
	assert.equal(bloom.fruiting, false)
	assert.equal(bloom.bare, false, 'a tree standing in its own spring is not bare')
	assert.equal(bloom.leafFalling, false)
	assert.equal(bloom.visualSeason, 'spring', 'the picture wears the show')
	assert.equal(bloom.season, 'winter', 'the grove sky is untouched')

	// Natural month 7: the bloom is long past, the autumn crop comes next.
	const summer = groveMonthStartMs(40, 7)
	const crop = computeTreeState({
		speciesId: 'apple',
		plantedAt: summer,
		firstTree: true,
		now: summer + 6 * HOUR + 1
	})
	assert.equal(crop.welcomeFlourish, 'fruit')
	assert.equal(crop.fruiting, true)
	assert.equal(crop.blooming, false)
	assert.equal(crop.fruitRound, WELCOME_FRUIT_ROUND)
	assert.equal(crop.visualSeason, 'autumn')
})

test('the welcome show lasts the maturing day only', () => {
	const plantedAt = groveMonthStartMs(40, 1)
	const nextDay = computeTreeState({
		speciesId: 'apple',
		plantedAt,
		firstTree: true,
		now: plantedAt + 6 * HOUR + 25 * HOUR
	})
	assert.equal(nextDay.welcomeFlourish, null)
	assert.equal(nextDay.blooming, false)
	assert.equal(nextDay.visualSeason, nextDay.season)
})

test('every species has a first day — pine wears cones, ginkgo wears gold', () => {
	// Planted in natural month 1, each species fast-forwards to its own next
	// window; nobody's welcome day is empty (§7.2).
	assert.equal(welcomeFlourishKind(speciesOf('apple'), 1), 'bloom')
	assert.equal(welcomeFlourishKind(speciesOf('cherry'), 1), 'bloom')
	assert.equal(welcomeFlourishKind(speciesOf('oak'), 1), 'fruit')
	assert.equal(welcomeFlourishKind(speciesOf('pine'), 1), 'cone')
	assert.equal(welcomeFlourishKind(speciesOf('ginkgo'), 1), 'gold')
	// Cones are a show, not a crop: nothing pickable hangs on a pine.
	const plantedAt = groveMonthStartMs(40, 1)
	const pine = computeTreeState({
		speciesId: 'pine',
		plantedAt,
		firstTree: true,
		now: plantedAt + 6 * HOUR + 1
	})
	assert.equal(pine.welcomeFlourish, 'cone')
	assert.equal(pine.fruiting, false)
	assert.equal(pine.fruitRound, null)
	assert.equal(pine.visualSeason, 'autumn')
})

test('fruit-signature species hang a welcome crop under the reserved round key', () => {
	// Oak blooms never, fruits in autumn; plant in natural winter (month 1).
	const plantedAt = groveMonthStartMs(40, 1)
	const state = computeTreeState({
		speciesId: 'oak',
		plantedAt,
		firstTree: true,
		now: plantedAt + 6 * HOUR + 1
	})
	assert.equal(state.welcomeFlourish, 'fruit')
	assert.equal(state.fruiting, true)
	assert.equal(state.fruitRound, WELCOME_FRUIT_ROUND)
})

test('a month boundary inside the welcome day cannot conjure a second crop', () => {
	// A natural month is only ~2.5 real days, so the welcome DAY routinely
	// outlives the month the tree was born into. Oak matures one hour before
	// month 11 → 12: the milestone (and the crop the DO materialized) is keyed
	// on month 11, where the sky's own fruit window was open. Three hours later
	// the grove has rolled into month 12 and that crop has expired — the state
	// must NOT then take the welcome override and claim the reserved round for
	// fruit nobody ever hung.
	const rollover = groveMonthStartMs(40, 12)
	const maturedAt = rollover - HOUR
	const plantedAt = maturedAt - FIRST_TREE_STAGE_MS.mature
	const now = rollover + 2 * HOUR
	assert.equal(utcDayOf(now), utcDayOf(maturedAt), 'still the same welcome day')
	assert.equal(groveMonthOf(maturedAt), 11)
	assert.equal(groveMonthOf(now), 12)

	const welcome = growthMilestonesBetween(
		{ speciesId: 'oak', plantedAt, firstTree: true },
		plantedAt,
		now
	).find((entry) => entry.kind === 'welcome_flourish')
	assert.equal(welcome.fruitRound, 40, 'the real round — the sky held the window open')

	const state = computeTreeState({ speciesId: 'oak', plantedAt, firstTree: true, now })
	assert.equal(state.welcomeFlourish, 'fruit')
	assert.equal(state.fruiting, false, 'the window closed; no welcome crop takes over')
	assert.equal(state.fruitRound, null)
	assert.equal(state.visualSeason, state.season)
})

test('the welcome crop hands over to the real one instead of overlapping it', () => {
	const apple = speciesOf('apple')
	// Matured in natural month 7: the TTL would outlive the autumn window's
	// opening, so the crop expires exactly when the real one hangs.
	const summer = groveMonthStartMs(40, 7) + 6 * HOUR
	assert.equal(welcomeCropExpiryMs(apple, summer), groveMonthStartMs(40, 9))
	assert.ok(welcomeCropExpiryMs(apple, summer) < summer + WELCOME_FRUIT_TTL_MS)
	// Matured in natural month 3: autumn is far away, the TTL stands.
	const spring = groveMonthStartMs(40, 3) + 6 * HOUR
	assert.equal(welcomeCropExpiryMs(apple, spring), spring + WELCOME_FRUIT_TTL_MS)
})

// ---------------------------------------------------------------------------
// Lazy settlement (TD-1): milestones backfill with real timestamps and the
// slicing is idempotent — adjacent (from, to] ranges never duplicate or drop.

test('normal-clock milestones carry the exact computed moments', () => {
	const apple = speciesOf('apple')
	const plantedAt = groveMonthStartMs(40, 1)
	const milestones = growthMilestonesBetween(
		{ speciesId: 'apple', plantedAt, firstTree: false },
		plantedAt,
		plantedAt + 2 * GROVE_YEAR_MS
	)
	const byKind = new Map(milestones.map((m) => [m.kind, m]))
	assert.equal(byKind.get('sprouted').at, plantedAt + apple.stageMs.sprout)
	assert.equal(byKind.get('seedling').at, plantedAt + apple.stageMs.seedling)
	assert.equal(byKind.get('young').at, plantedAt + apple.stageMs.young)
	assert.equal(byKind.get('matured').at, plantedAt + apple.stageMs.mature)
	assert.ok(!byKind.has('first_leaf'), 'first leaf is a welcome-show-only beat')
	assert.ok(!byKind.has('welcome_flourish'))

	// Windows recur naturally: fruit in year 40 autumn, bloom in year 41 spring.
	const fruitStarts = milestones.filter((m) => m.kind === 'fruit_started')
	const bloomStarts = milestones.filter((m) => m.kind === 'bloom_started')
	assert.equal(fruitStarts.length, 2)
	assert.deepEqual(
		fruitStarts.map((m) => m.at),
		[groveMonthStartMs(40, 9), groveMonthStartMs(41, 9)]
	)
	assert.deepEqual(
		fruitStarts.map((m) => m.fruitRound),
		[40, 41]
	)
	assert.equal(bloomStarts.length, 1)
	assert.equal(bloomStarts[0].at, groveMonthStartMs(41, 4))
})

test('a tree maturing mid-window starts fruiting at the maturity moment', () => {
	// Plant so maturity (21d ≈ 8.3 natural months later) lands inside oak's
	// autumn fruit window.
	const oak = speciesOf('oak')
	const plantedAt = groveMonthStartMs(40, 2)
	const maturedAt = plantedAt + oak.stageMs.mature
	assert.ok([9, 10, 11].includes(groveMonthOf(maturedAt)))
	const milestones = growthMilestonesBetween(
		{ speciesId: 'oak', plantedAt, firstTree: false },
		plantedAt,
		maturedAt + DAY
	)
	const fruitStart = milestones.find((m) => m.kind === 'fruit_started')
	assert.equal(fruitStart.at, maturedAt)
	assert.equal(fruitStart.fruitRound, groveYearOf(maturedAt))
})

test('milestone slicing is idempotent across adjacent ranges', () => {
	const plantedAt = groveMonthStartMs(40, 1)
	const input = { speciesId: 'apple', plantedAt, firstTree: false }
	const whole = growthMilestonesBetween(input, plantedAt, plantedAt + 2 * GROVE_YEAR_MS)
	assert.ok(whole.length >= 7)

	const cuts = [
		plantedAt,
		plantedAt + 10 * DAY,
		plantedAt + speciesOf('apple').stageMs.mature, // exact boundary
		plantedAt + GROVE_YEAR_MS,
		plantedAt + 2 * GROVE_YEAR_MS
	]
	const sliced = []
	for (let index = 0; index + 1 < cuts.length; index += 1) {
		sliced.push(...growthMilestonesBetween(input, cuts[index], cuts[index + 1]))
	}
	assert.deepEqual(sliced, whole)
})

test('pine (no pickable crop) never emits fruit_started', () => {
	const plantedAt = groveMonthStartMs(40, 1)
	const milestones = growthMilestonesBetween(
		{ speciesId: 'pine', plantedAt, firstTree: false },
		plantedAt,
		plantedAt + 3 * GROVE_YEAR_MS
	)
	assert.ok(milestones.every((m) => m.kind !== 'fruit_started' && m.kind !== 'bloom_started'))
})

// ---------------------------------------------------------------------------
// Quiet trees (§12.2: 安静, never death)

test('a tree goes quiet after a month without care and wakes with care', () => {
	const plantedAt = groveMonthStartMs(40, 3)
	const base = { speciesId: 'pine', plantedAt, firstTree: false }
	const later = plantedAt + 31 * DAY
	assert.equal(computeTreeState({ ...base, now: later }).quiet, true)
	assert.equal(computeTreeState({ ...base, lastCareAt: later - DAY, now: later }).quiet, false)
})

// ---------------------------------------------------------------------------
// Shake (TD-2: sealed daily outcome, gates, seasonal modulation)

test('shake settlement is deterministic per (tree, actor, day)', () => {
	const context = {
		treeId: 'tree_A',
		actorId: 'actor_1',
		utcDay: 20_000,
		speciesId: 'apple',
		stage: 'mature',
		month: 9,
		fruitAvailable: true,
		dewBelowCap: true,
		messageAvailable: true
	}
	const first = resolveShake(context)
	for (let repeat = 0; repeat < 5; repeat += 1) {
		assert.deepEqual(resolveShake(context), first)
	}
	assert.ok(first.factIndex >= 0 && first.factIndex < GROVE_FACT_COUNT)
	// A different actor or day may (and generally does) land elsewhere.
	const other = resolveShake({ ...context, actorId: 'actor_2' })
	assert.ok(Number.isInteger(other.roll))
})

test('shake gates: impossible outcomes never surface', () => {
	for (let day = 0; day < 600; day += 1) {
		const gated = resolveShake({
			treeId: 'tree_B',
			actorId: 'actor_1',
			utcDay: day,
			speciesId: 'apple',
			stage: 'young',
			month: 6,
			fruitAvailable: false,
			dewBelowCap: false,
			messageAvailable: false
		})
		assert.ok(!['fruit', 'seed', 'dew', 'message'].includes(gated.outcome), gated.outcome)
	}
})

test('shake distribution roughly follows the drop table and boosts seeds in the fruit window', () => {
	const count = (month) => {
		const counts = {}
		for (let day = 0; day < 3000; day += 1) {
			const { outcome } = resolveShake({
				treeId: 'tree_C',
				actorId: 'actor_1',
				utcDay: day,
				speciesId: 'apple',
				stage: 'mature',
				month,
				fruitAvailable: true,
				dewBelowCap: true,
				messageAvailable: true
			})
			counts[outcome] = (counts[outcome] ?? 0) + 1
		}
		return counts
	}
	const inWindow = count(9)
	const offWindow = count(6)
	for (const outcome of ['leaf', 'nothing', 'bird', 'fact', 'dew', 'fruit', 'seed', 'message']) {
		assert.ok((offWindow[outcome] ?? 0) > 0, `expected some ${outcome}`)
	}
	assert.ok(inWindow.seed > offWindow.seed, 'seeds fall more readily inside the fruit window')
})

test('water effect variety is deterministic and four-way', () => {
	const index = waterEffectIndex('tree_D', 'actor_1', 123)
	assert.equal(waterEffectIndex('tree_D', 'actor_1', 123), index)
	assert.ok(index >= 0 && index < 4)
	const seen = new Set()
	for (let day = 0; day < 40; day += 1) seen.add(waterEffectIndex('tree_D', 'actor_1', day))
	assert.equal(seen.size, 4)
})

// ---------------------------------------------------------------------------
// Fruit rounds (§14.1 主人保底果)

test('fruit batches are deterministic, in range, and always reserve one for the owner', () => {
	const apple = speciesOf('apple')
	for (let round = 0; round < 50; round += 1) {
		const batch = rollFruitBatch('tree_E', round, apple)
		assert.deepEqual(rollFruitBatch('tree_E', round, apple), batch)
		assert.ok(batch.count >= 5 && batch.count <= 8)
		assert.ok(batch.reservedIndex >= 0 && batch.reservedIndex < batch.count)
	}
	assert.deepEqual(rollFruitBatch('tree_E', 3, speciesOf('pine')), {
		count: 0,
		reservedIndex: null
	})
})

test('the reserved fruit answers only to the land owner', () => {
	assert.equal(canPickFruit({ ownerReserved: true, actorIsOwner: false }), false)
	assert.equal(canPickFruit({ ownerReserved: true, actorIsOwner: true }), true)
	assert.equal(canPickFruit({ ownerReserved: false, actorIsOwner: false }), true)
})

test('fruit and seed lifecycles follow their state machines', () => {
	assert.equal(canTransitionFruit('hanging', 'picked'), true)
	assert.equal(canTransitionFruit('hanging', 'eaten'), false)
	assert.equal(canTransitionFruit('picked', 'eaten'), true)
	assert.equal(canTransitionFruit('picked', 'seeded'), true)
	assert.equal(canTransitionFruit('placed', 'picked'), true)
	assert.equal(canTransitionFruit('eaten', 'picked'), false)

	assert.equal(canTransitionSeed('stored', 'planted'), true)
	assert.equal(canTransitionSeed('stored', 'windborne'), true)
	assert.equal(canTransitionSeed('windborne', 'stored'), true)
	assert.equal(canTransitionSeed('planted', 'stored'), false)

	// WP-G5 compensation edges: a marked gift walks back when the grant fails.
	assert.equal(canTransitionFruit('gifted', 'picked'), true)
	assert.equal(canTransitionSeed('gifted', 'stored'), true)
	assert.equal(canTransitionTrayFruit('held', 'gifted'), true)
	assert.equal(canTransitionTrayFruit('gifted', 'held'), true)
	assert.equal(canTransitionTrayFruit('placed', 'held'), true)
	assert.equal(canTransitionTrayFruit('eaten', 'held'), false)
	assert.equal(canTransitionTrayFruit('seeded', 'held'), false)

	// WP-G6 guest-request lock: a requested seed can only be consumed by the
	// accept (planted) or handed back (stored) — never gifted past the owner.
	assert.equal(canTransitionSeed('stored', 'requested'), true)
	assert.equal(canTransitionSeed('requested', 'planted'), true)
	assert.equal(canTransitionSeed('requested', 'stored'), true)
	assert.equal(canTransitionSeed('requested', 'gifted'), false)
	assert.equal(canTransitionSeed('requested', 'windborne'), false)
})

// ---------------------------------------------------------------------------
// Dew ledger (§9.1, §26.1)

test('dew refreshes each UTC day and fruit restores at most one drop', () => {
	const day = utcDayOf(Date.UTC(2026, 6, 20, 8))
	let ledger = resolveDewLedger(null, day, DAILY_DEW)
	assert.deepEqual(ledger, {
		utcDay: day,
		dewRemaining: DAILY_DEW,
		dewFromFruit: 0,
		windSeedChecked: false
	})
	// Same-day resolve is a no-op; next day rolls fresh.
	assert.equal(resolveDewLedger(ledger, day, DAILY_DEW), ledger)
	ledger = { ...ledger, dewRemaining: 0 }
	assert.equal(resolveDewLedger(ledger, day + 1, DAILY_DEW).dewRemaining, DAILY_DEW)
	// 一块土地一滴晨露 (§9.1): today's three plots are today's three drops, and a
	// grove that gains land wakes up to more without anything else changing.
	assert.equal(DAILY_DEW, GROVE_OWNER_PLOTS.length)
	assert.equal(dailyDewFor(5), 5)
	assert.equal(dailyDewFor(0), 1)
	assert.equal(resolveDewLedger(null, day, dailyDewFor(5)).dewRemaining, 5)

	// At the cap, eating fruit never overfills.
	const full = resolveDewLedger(null, day, DAILY_DEW)
	const stillFull = applyFruitDew(full, DAILY_DEW)
	assert.equal(stillFull.dewRemaining, DAILY_DEW)
	assert.equal(stillFull.dewFromFruit, 1)

	// Below the cap it restores one drop, once per day.
	let low = { ...resolveDewLedger(null, day), dewRemaining: 0 }
	low = applyFruitDew(low, DAILY_DEW)
	assert.equal(low.dewRemaining, 1)
	assert.equal(low.dewFromFruit, DEW_FROM_FRUIT_DAILY_CAP)
	const capped = applyFruitDew(low, DAILY_DEW)
	assert.equal(capped.dewRemaining, 1, 'second fruit of the day restores nothing')
})

// ---------------------------------------------------------------------------
// Weather and wind (§4.2, TD-5)

test('weather is deterministic and drawn from the season pool', () => {
	const pools = {
		spring: ['bloom', 'sun', 'rain', 'wind'],
		summer: ['sun', 'rain', 'wind'],
		autumn: ['fall', 'wind', 'sun'],
		winter: ['snow', 'sun']
	}
	let meteorNights = 0
	for (let day = 20_000; day < 20_200; day += 1) {
		const weather = weatherOf(day)
		assert.deepEqual(weatherOf(day), weather)
		assert.ok(pools[weather.season].includes(weather.kind), `${weather.kind} in ${weather.season}`)
		if (weather.meteorNight) meteorNights += 1
	}
	assert.ok(meteorNights > 0 && meteorNights < 60, `meteor nights stay rare (${meteorNights})`)
})

test('the wind visits deterministically and at roughly the configured rate', () => {
	let visits = 0
	for (let day = 0; day < 2000; day += 1) {
		const blows = windBlowsFor('user_1', day)
		assert.equal(windBlowsFor('user_1', day), blows)
		if (blows) visits += 1
	}
	const rate = visits / 2000
	assert.ok(rate > 0.17 && rate < 0.33, `wind rate ${rate}`)
})

// ---------------------------------------------------------------------------
// Notes and guest requests (§16, §11.2)

test('notes are one small immutable line', () => {
	assert.equal(
		normalizeGroveMessage('  希望它长得比我们的产品更稳。  '),
		'希望它长得比我们的产品更稳。'
	)
	assert.equal(normalizeGroveMessage('a\n b'), 'a b')
	assert.throws(
		() => normalizeGroveMessage('   '),
		(e) => e.code === 'GROVE_MESSAGE_EMPTY'
	)
	assert.throws(
		() => normalizeGroveMessage('x'.repeat(GROVE_MESSAGE_MAX_LENGTH + 1)),
		(e) => e.code === 'GROVE_MESSAGE_TOO_LONG'
	)
	// WP-G5 anti-ad wall: words, not links (URLs, www hosts, bare domains, emails).
	for (const spam of [
		'check https://spam.example now',
		'visit www.spam-site.example',
		'best deals at cheap.com',
		'write me a@b.net'
	]) {
		assert.throws(
			() => normalizeGroveMessage(spam),
			(e) => e.code === 'GROVE_MESSAGE_LINK',
			spam
		)
	}
	assert.equal(normalizeGroveMessage('祝它长青。'), '祝它长青。')

	assert.equal(canTransitionGroveMessage('active', 'retracted', 'author'), true)
	assert.equal(canTransitionGroveMessage('active', 'retracted', 'owner'), false)
	assert.equal(canTransitionGroveMessage('active', 'removed', 'owner'), true)
	assert.equal(canTransitionGroveMessage('active', 'removed', 'author'), false)
	assert.equal(canTransitionGroveMessage('retracted', 'removed', 'owner'), false)
})

test('guest plant requests decide exactly once', () => {
	assert.equal(canTransitionGuestRequest('pending', 'accepted'), true)
	assert.equal(canTransitionGuestRequest('pending', 'declined'), true)
	assert.equal(canTransitionGuestRequest('pending', 'canceled'), true)
	assert.equal(canTransitionGuestRequest('accepted', 'declined'), false)
	assert.throws(
		() => assertGuestRequestTransition('declined', 'accepted'),
		(e) => AlinkCoreError.from(e)?.code === 'GROVE_INVALID_REQUEST_TRANSITION'
	)
})

// ---------------------------------------------------------------------------
// Land and settings (§10, §27.3)

test('plots split three owner beds and one guest plot', () => {
	assert.deepEqual([0, 1, 2].map(plotTypeOf), ['owner', 'owner', 'owner'])
	assert.equal(plotTypeOf(GROVE_GUEST_PLOT_INDEX), 'guest')
	assert.throws(
		() => plotTypeOf(4),
		(e) => e.code === 'GROVE_INVALID_PLOT'
	)
	assert.equal(DEFAULT_GROVE_SETTINGS.guestPlotMode, 'confirm')
	assert.equal(DEFAULT_GROVE_SETTINGS.windSeedEnabled, true)
})

// ---------------------------------------------------------------------------
// 野风 (§15.1): the forest's own seed, weighted and replay-proof.

test('the wild wind draws by weight, deterministically', () => {
	const day = 20_000
	const drawn = wildWindSpeciesFor('d9c69eq2he60009l1ipg', day)
	assert.equal(
		drawn,
		wildWindSpeciesFor('d9c69eq2he60009l1ipg', day),
		'same person, same day, same seed — reloading cannot re-roll it'
	)
	assert.ok(GROVE_SPECIES_IDS.includes(drawn))

	// A grove with nothing in it yet only ever draws a simple starter (§26.4).
	for (let step = 0; step < 200; step += 1) {
		const starter = wildWindSpeciesFor('d9c69eq2he60009l1ipg', day + step, GROVE_STARTER_SPECIES)
		assert.ok(GROVE_STARTER_SPECIES.includes(starter), `${starter} is not a starter`)
	}
	assert.equal(wildWindSpeciesFor('d9c69eq2he60009l1ipg', day, []), null, 'no pool, no seed')

	// Every species the catalog lets the wind carry is reachable, and the slow
	// precious ones stay rarer than the common ones.
	const counts = new Map()
	for (let step = 0; step < 4000; step += 1) {
		const id = wildWindSpeciesFor(`wind-${step % 50}`, day + step)
		counts.set(id, (counts.get(id) ?? 0) + 1)
	}
	for (const id of GROVE_SPECIES_IDS) {
		if (GROVE_SPECIES[id].wildSeedWeight <= 0) continue
		assert.ok((counts.get(id) ?? 0) > 0, `${id} never blows in`)
	}
	assert.ok(counts.get('apple') > counts.get('huanghuali'))
	assert.ok(counts.get('pine') > counts.get('blackwood'))
	assert.ok(counts.get('oak') > counts.get('redwood'))
})

// ---------------------------------------------------------------------------
// Catalog admission gate (TD-1): every entry validates and its full-year
// phenology matches the reviewed profile. A future species lands by adding
// its profile here — the snapshot review IS the admission decision.

test('every catalog entry passes structural validation', () => {
	assert.deepEqual(GROVE_SPECIES_IDS, [
		'apple',
		'cherry',
		'ginkgo',
		'oak',
		'pine',
		'redwood',
		'bodhi',
		'cypress',
		'blackwood',
		'huanghuali'
	])
	for (const id of GROVE_SPECIES_IDS) {
		validateSpeciesDef(GROVE_SPECIES[id])
	}
	// The first-tree choice is its own reviewed snapshot (§7.1): a species does
	// not become a starter by accident.
	assert.deepEqual(GROVE_STARTER_SPECIES, ['apple', 'cherry', 'pine', 'redwood', 'cypress'])
	for (const id of GROVE_STARTER_SPECIES) {
		assert.ok(GROVE_SPECIES[id], `starter ${id} exists`)
		// Every starter must give the welcome show something to play (§7.2).
		assert.ok(welcomeFlourishKind(GROVE_SPECIES[id], 1), `starter ${id} has an empty first day`)
	}
	assert.throws(
		() => speciesOf('kudzu'),
		(e) => e.code === 'GROVE_SPECIES_UNKNOWN'
	)
})

test('validation rejects malformed species data', () => {
	const apple = speciesOf('apple')
	const broken = (patch) => ({ ...apple, ...patch, id: 'testling' })
	assert.throws(
		() =>
			validateSpeciesDef(broken({ stageMs: { ...apple.stageMs, mature: apple.stageMs.young } })),
		(e) => e.code === 'GROVE_SPECIES_INVALID'
	)
	assert.throws(
		() =>
			validateSpeciesDef(
				broken({ phenology: { ...apple.phenology, bloomMonths: [1], bareMonths: [1, 2, 12] } })
			),
		(e) => e.code === 'GROVE_SPECIES_INVALID'
	)
	assert.throws(
		() => validateSpeciesDef(broken({ habit: 'evergreen' })),
		(e) => e.code === 'GROVE_SPECIES_INVALID',
		'evergreen with bare months'
	)
	assert.throws(
		() => validateSpeciesDef(broken({ fruitCount: [5, 3] })),
		(e) => e.code === 'GROVE_SPECIES_INVALID'
	)
})

/** month → flags digest, e.g. { bloom: [4,5], fruit: [], bare: [12,1,2] }. */
function phenologyProfile(speciesId) {
	const profile = { bloom: [], fruit: [], autumnColor: [], leafFall: [], bare: [] }
	for (const sample of simulateSpeciesYear(speciesId)) {
		if (sample.blooming) profile.bloom.push(sample.month)
		if (sample.fruiting) profile.fruit.push(sample.month)
		if (sample.autumnColor) profile.autumnColor.push(sample.month)
		if (sample.leafFalling) profile.leafFall.push(sample.month)
		if (sample.bare) profile.bare.push(sample.month)
	}
	return profile
}

test('full-year phenology simulation matches the reviewed profile per species', () => {
	assert.deepEqual(phenologyProfile('apple'), {
		bloom: [4, 5],
		fruit: [9, 10],
		autumnColor: [10, 11],
		leafFall: [11],
		bare: [1, 2, 12]
	})
	assert.deepEqual(phenologyProfile('cherry'), {
		bloom: [4],
		fruit: [],
		autumnColor: [10, 11],
		leafFall: [11],
		bare: [1, 2, 12]
	})
	assert.deepEqual(phenologyProfile('ginkgo'), {
		bloom: [],
		fruit: [],
		autumnColor: [10, 11],
		leafFall: [11],
		bare: [1, 2, 12]
	})
	assert.deepEqual(phenologyProfile('oak'), {
		bloom: [],
		fruit: [9, 10, 11],
		autumnColor: [10, 11],
		leafFall: [11],
		bare: [1, 2, 12]
	})
	assert.deepEqual(phenologyProfile('pine'), {
		bloom: [],
		fruit: [],
		autumnColor: [],
		leafFall: [],
		bare: []
	})
	// Second batch: evergreens whose cones/pods ride the window as visuals show
	// an empty profile (nothing pickable hangs) — only the fig bears a crop.
	assert.deepEqual(phenologyProfile('redwood'), {
		bloom: [],
		fruit: [],
		autumnColor: [],
		leafFall: [],
		bare: []
	})
	assert.deepEqual(phenologyProfile('bodhi'), {
		bloom: [],
		fruit: [9, 10],
		autumnColor: [],
		leafFall: [],
		bare: []
	})
	assert.deepEqual(phenologyProfile('cypress'), {
		bloom: [],
		fruit: [],
		autumnColor: [],
		leafFall: [],
		bare: []
	})
	assert.deepEqual(phenologyProfile('blackwood'), {
		bloom: [4, 5],
		fruit: [],
		autumnColor: [10],
		leafFall: [11],
		bare: [1, 12]
	})
	assert.deepEqual(phenologyProfile('huanghuali'), {
		bloom: [4, 5],
		fruit: [],
		autumnColor: [11],
		leafFall: [12],
		bare: [1, 2]
	})
	// Blooming or fruiting never overlaps a bare month, for any species.
	for (const id of GROVE_SPECIES_IDS) {
		for (const sample of simulateSpeciesYear(id)) {
			assert.ok(
				!(sample.bare && (sample.blooming || sample.fruiting)),
				`${id} month ${sample.month}`
			)
		}
	}
})

// 一个真相，两个画师: the one word a grove gets, for the forest walk and for a
// sprite looking around. The ORDER is the contract — 奇观 > 可行动 > 刚发芽 —
// and it is the whole reason this function exists, so it is pinned here rather
// than in either caller.
const show = (over) => ({
	stage: 'mature',
	blooming: false,
	fruiting: false,
	coneBearing: false,
	autumnColor: false,
	...over
})

test('a spectacle outranks a sprout, in both painters', () => {
	// The regression this exists for: a single seedling used to be checked
	// first, so one sprout silenced a grove standing in full autumn gold.
	const grove = [show({ stage: 'sprout' }), show({ autumnColor: true })]
	assert.equal(spectacleOf(grove), 'gold')
	assert.equal(hasSprouting(grove), true)

	assert.equal(spectacleOf([show({ blooming: true }), show({ fruiting: true })]), 'blooming')
	assert.equal(spectacleOf([show({ fruiting: true }), show({ autumnColor: true })]), 'fruiting')
	assert.equal(spectacleOf([show({ autumnColor: true }), show({ coneBearing: true })]), 'gold')
	assert.equal(spectacleOf([show({ coneBearing: true })]), 'cones')
	assert.equal(spectacleOf([show({ stage: 'seedling' })]), null)
})

test('gold needs a canopy, cones are a show of their own', () => {
	// `autumnColor` is true of anything past seed, so without the canopy guard a
	// two-leaf sprout would headline «this grove is turning gold».
	assert.equal(spectacleOf([show({ stage: 'sprout', autumnColor: true })]), null)
	assert.equal(spectacleOf([show({ stage: 'seedling', autumnColor: true })]), null)
	assert.equal(spectacleOf([show({ stage: 'young', autumnColor: true })]), 'gold')

	// Three of the five STARTER species can never bloom and never hang pickable
	// fruit — cones are the only show they have, and before this they had no word
	// at all. Derived from `GROVE_STARTER_SPECIES` rather than named, because the
	// claim this rung exists for is about the trees a beginner is offered: if the
	// starter set ever changes, this assertion has to move with it instead of
	// quietly staying green about three species nobody starts with.
	//
	// The predicate is `computeTreeState`'s own, both halves of it: an ornamental
	// cherry also hangs `fruitCount` 0, but it has NO fruit window, so it wears
	// blossom and never cones. Filtering on the count alone would have quietly
	// promised «结满了球果» about a cherry tree.
	const coneStarters = GROVE_STARTER_SPECIES.filter((id) => {
		const def = speciesOf(id)
		return def.fruitCount[1] === 0 && def.phenology.fruitMonths.length > 0
	})
	assert.equal(coneStarters.length, 3, GROVE_STARTER_SPECIES.join())
	for (const id of coneStarters) {
		const def = speciesOf(id)
		assert.equal(def.phenology.bloomMonths.length, 0, id)
		const state = computeTreeState({
			speciesId: id,
			plantedAt: groveMonthStartMs(0, def.phenology.fruitMonths[0]) - GROVE_YEAR_MS,
			firstTree: false,
			now: groveMonthStartMs(0, def.phenology.fruitMonths[0]) + 3_600_000
		})
		assert.equal(state.coneBearing, true, id)
		assert.equal(state.fruiting, false, id)
		assert.equal(spectacleOf([state]), 'cones', id)
	}
})

test('morph seeds are stable per tree id', () => {
	assert.equal(morphSeedOf('tree_X'), morphSeedOf('tree_X'))
	assert.notEqual(morphSeedOf('tree_X'), morphSeedOf('tree_Y'))
})

// §27.4: the departed-user sentinel must be unclaimable on BOTH namespaces —
// not an xid (so it can never collide with a real id) and reserved as a handle
// (so al.ink/departed can never resolve to somebody who registered the word and
// inherited every 「一位已离开的用户」 link the API hands out).
test('the departed-user sentinel can never resolve to a real account', () => {
	assert.equal(isValidXid(GROVE_DEPARTED_USER), false)
	assert.ok(isReservedHandle(GROVE_DEPARTED_USER))
})
