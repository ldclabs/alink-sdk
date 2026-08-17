import { AlinkCoreError } from './errors.js'

// ---------------------------------------------------------------------------
// Grove growth engine (docs/alink-grove.md v1.1, devplan TD-1/TD-2). Pure
// domain: the current shape of every tree is a deterministic function of
// (species data, plantedAt, care history, now) — no cron, no alarm, no clock
// reads. Storage and arbitration live in GroveDO; nothing here may touch the
// network or `Date.now()`.
//
// Engine discipline (TD-1): the species catalog is DATA and the engine is a
// generic phenology machine. No `if (species === 'apple')` branches — adding
// a species must never change engine code. Published species definitions are
// append-only: tweaking numbers for a shipped species changes live trees, so
// treat every entry below as frozen once the flag opens.

// ---------------------------------------------------------------------------
// Clocks (product §4.1 双时钟)

/** Season clock runs at exactly 12× real time: one real month ≈ one natural
 * year, one season ≈ 7.6 real days. The epoch anchors natural-year day zero
 * (a natural January 1st); all groves share this single global clock. */
export const GROVE_TIME_SCALE = 12
export const GROVE_EPOCH_MS = Date.UTC(2026, 0, 1)
/** One accelerated natural year in real ms (365.2425d / 12 ≈ 30.44 real days). */
export const GROVE_YEAR_MS = Math.round((365.2425 * 86_400_000) / GROVE_TIME_SCALE)

export type GroveSeason = 'spring' | 'summer' | 'autumn' | 'winter'

/** Whole UTC day index (unix ms → days since epoch). The daily unit for dew,
 * shake limits and weather — never timezone-local. */
export function utcDayOf(ms: number): number {
	return Math.floor(ms / 86_400_000)
}

/** Natural-year index since the grove epoch (may be negative before it). Used
 * as the fruiting round key. */
export function groveYearOf(now: number): number {
	return Math.floor((now - GROVE_EPOCH_MS) / GROVE_YEAR_MS)
}

/** Days in a natural year — the same 365.2425 `GROVE_YEAR_MS` is built from. */
export const NATURAL_YEAR_DAYS = 365.2425

/**
 * How old a tree is, TOLD ON THE WORLD'S OWN CLOCK (§4.1 双时钟).
 *
 * A tree's whole life — sprouting, blossom, fruit, the leaves going gold —
 * runs on the accelerated clock, so its age belongs to that clock too. Counting
 * the real days instead («Day 47») measured the reader's calendar, not the
 * tree's, and it said nothing: a tree that has stood through eight real years
 * has lived a CENTURY here, and «Day 2922» buries that.
 *
 * Two units, one switch: under a natural year the age is in natural days (12
 * per real day, so the number moves visibly while a sapling is still new);
 * from the first birthday on it is whole years, which is the number that grows
 * into 「第 96 年」 and reads like the old tree it has become.
 *
 * @param realDays whole real days since planting (the stored `ageDays`)
 */
export function treeAgeOf(realDays: number): { unit: 'day' | 'year'; value: number } {
	// Day 1 is the day it went in: a tree planted an hour ago has lived no full
	// natural day yet, and «Day 0» is not a thing anyone says about a sapling.
	const naturalDays = Math.max(1, Math.floor(Math.max(0, realDays)) * GROVE_TIME_SCALE)
	const years = Math.floor(naturalDays / NATURAL_YEAR_DAYS)
	return years >= 1 ? { unit: 'year', value: years } : { unit: 'day', value: naturalDays }
}

/** Natural month 1..12 of the accelerated year (1 = natural January). */
export function groveMonthOf(now: number): number {
	const intoYear = (((now - GROVE_EPOCH_MS) % GROVE_YEAR_MS) + GROVE_YEAR_MS) % GROVE_YEAR_MS
	return Math.min(12, Math.floor((intoYear / GROVE_YEAR_MS) * 12) + 1)
}

/** Real timestamp at which natural month `month` (1..12) of grove year `year`
 * begins. Inverse of groveMonthOf/groveYearOf for milestone backfill. */
export function groveMonthStartMs(year: number, month: number): number {
	return GROVE_EPOCH_MS + year * GROVE_YEAR_MS + Math.round(((month - 1) / 12) * GROVE_YEAR_MS)
}

const SEASON_BY_MONTH: readonly GroveSeason[] = [
	'winter', // 1
	'winter', // 2
	'spring', // 3
	'spring', // 4
	'spring', // 5
	'summer', // 6
	'summer', // 7
	'summer', // 8
	'autumn', // 9
	'autumn', // 10
	'autumn', // 11
	'winter' // 12
]

export function seasonOfMonth(month: number): GroveSeason {
	const season = SEASON_BY_MONTH[month - 1]
	if (!season) {
		throw new AlinkCoreError('GROVE_INVALID_MONTH', `Natural month out of range: ${month}`)
	}
	return season
}

/** Global shared season (product §4.1): every grove sees the same sky. */
export function seasonOf(now: number): GroveSeason {
	return seasonOfMonth(groveMonthOf(now))
}

// ---------------------------------------------------------------------------
// Species catalog (TD-1: declarative data, generic engine)

export type TreeStage = 'seed' | 'sprout' | 'seedling' | 'young' | 'mature'
export const TREE_STAGES: readonly TreeStage[] = ['seed', 'sprout', 'seedling', 'young', 'mature']

export type SpeciesHabit = 'deciduous' | 'evergreen'
export type SpeciesFoliage = 'broadleaf' | 'needleleaf' | 'fan'
export type SpeciesLifespan = 'medium' | 'long' | 'very_long'
export type SeedKind = 'pip' | 'stone' | 'nut' | 'cone' | 'naked' | 'pod'
/** Silhouette archetype library (TD-8): most new species only re-parameterize
 * one of these; adding an archetype is the rare event. */
export type TreeArchetype = 'broad' | 'fan' | 'conifer'

export type ShakeOutcome =
	'leaf' | 'nothing' | 'bird' | 'fact' | 'dew' | 'fruit' | 'seed' | 'message'

export interface SpeciesSeasonColors {
	spring: string
	summer: string
	autumn: string
	/** Evergreens keep a winter color; deciduous species omit it (bare). */
	winter?: string
}

/** Rendering parameters shared by the app TreeVis component and the OG-card
 * fallback painter (TD-8). Colors come from the WP-G0 prototype swatches. */
export interface SpeciesVisual {
	archetype: TreeArchetype
	/** Crown width ratio (broad archetype), 1 = apple baseline. */
	crown: number
	/** Crown height ratio. */
	crownHeight: number
	/** Trunk width ratio. */
	trunkWidth: number
	leaf: SpeciesSeasonColors
	leaf2: SpeciesSeasonColors
	blossomColor?: string
	fruitColor?: string
	fruitShape?: 'round' | 'acorn' | 'cone'
	/** Spring petals drift down while blooming (cherry). */
	petalFall?: boolean
}

/** Elapsed-ms thresholds after planting for each post-seed stage (per-species
 * compressed life clock, §4.1: days to seedling, ~a week to young, 2-3 weeks
 * to maturity). Strictly increasing. */
export type StageClock = Record<Exclude<TreeStage, 'seed'>, number>

export interface SpeciesPhenology {
	/** Natural months (1..12) with open blossom on mature trees. */
	bloomMonths: readonly number[]
	/** Months a mature tree carries its fruit/nut/cone crop. Pickable only when
	 * fruitCount > 0; otherwise purely visual + shake seed-drop boost. */
	fruitMonths: readonly number[]
	/** Months the foliage turns (autumn gold/bronze). */
	autumnColorMonths: readonly number[]
	/** Months falling-leaf drift is visible. */
	leafFallMonths: readonly number[]
	/** Months a deciduous silhouette stands bare. Empty for evergreens. */
	bareMonths: readonly number[]
}

/** Base shake-drop weights (TD-2). The engine gates and seasonally modulates
 * these; zero disables an outcome for the species entirely. */
export interface SpeciesDropTable {
	leaf: number
	nothing: number
	bird: number
	fact: number
	dew: number
	fruit: number
	seed: number
	message: number
}

/**
 * 尺寸 (§4.1 自然属性): how big this species gets, so a reader can be told what
 * they are standing in front of. Data only — nothing in the engine branches on
 * it, and the painter's silhouette is unchanged (a stylized tree drawn at card
 * size cannot honestly carry an 80m redwood).
 */
export interface SpeciesSize {
	/** Height in metres this species approaches in old age. */
	matureHeightM: number
	/** Natural years at which it stands HALF that tall. The curve is hyperbolic
	 * (`h = max·y/(y+half)`): fast while young — a tree has to look like a tree
	 * by the time it fruits — then creeping for the rest of its life, which is
	 * how real height growth behaves. */
	halfHeightYears: number
	/** Trunk circumference in centimetres laid down per natural year. This is
	 * the number that carries an old tree: height plateaus, girth does not, and
	 * a 5-metre trunk is what 「百年大树」 actually means to a pair of eyes. */
	girthCmPerYear: number
}

export interface SpeciesDef {
	id: string
	habit: SpeciesHabit
	foliage: SpeciesFoliage
	lifespan: SpeciesLifespan
	/** 0..1 water preference (§4.1 自然属性). Informational in MVP: it shades
	 * copy and future morphology, never growth speed (§26.3 浇水不加速成熟). */
	waterAffinity: number
	seedKind: SeedKind
	stageMs: StageClock
	size: SpeciesSize
	phenology: SpeciesPhenology
	/** Hanging pickable fruits per round on a mature tree, [min, max] inclusive.
	 * [0, 0] = the species never hangs pickable fruit (seeds come from shakes). */
	fruitCount: readonly [number, number]
	/** Relative weight in the wild wind (§15.1 野风): how readily a seed of
	 * this species arrives from the forest itself rather than from someone's
	 * grove. 0 = the wild wind never carries it. Rare trees sit low. */
	wildSeedWeight: number
	drop: SpeciesDropTable
	visual: SpeciesVisual
}

const DAY = 86_400_000
const HOUR = 3_600_000

/** Default drop weights mirror the WP-G0 prototype feel; species override
 * individual entries (e.g. conifers drop cones as seeds more readily). */
const BASE_DROP: SpeciesDropTable = {
	leaf: 3,
	nothing: 2,
	bird: 1.2,
	fact: 2,
	dew: 2,
	fruit: 2.2,
	seed: 1.4,
	message: 1.4
}

/**
 * MVP catalog (product §12.1). Data only — the long-term goal is covering most
 * common real-world species by adding entries (or, later, external data files)
 * without touching the engine. Every entry must pass `validateSpeciesDef` and
 * the full-year phenology simulation in test/domain-grove.test.mjs (the
 * admission gate for future species).
 */
export const GROVE_SPECIES: Readonly<Record<string, SpeciesDef>> = Object.freeze({
	apple: {
		id: 'apple',
		habit: 'deciduous',
		foliage: 'broadleaf',
		lifespan: 'medium',
		waterAffinity: 0.7,
		seedKind: 'pip',
		stageMs: { sprout: 12 * HOUR, seedling: 2 * DAY, young: 6 * DAY, mature: 14 * DAY },
		size: { matureHeightM: 9, halfHeightYears: 3, girthCmPerYear: 1.8 },
		phenology: {
			bloomMonths: [4, 5],
			fruitMonths: [9, 10],
			autumnColorMonths: [10, 11],
			leafFallMonths: [11],
			bareMonths: [12, 1, 2]
		},
		fruitCount: [5, 8],
		wildSeedWeight: 3,
		drop: BASE_DROP,
		visual: {
			archetype: 'broad',
			crown: 1,
			crownHeight: 0.95,
			trunkWidth: 1,
			leaf: { spring: '#7FA55F', summer: '#4F7D4C', autumn: '#74904E' },
			leaf2: { spring: '#98B979', summer: '#649160', autumn: '#8CA362' },
			blossomColor: '#F2E2E6',
			fruitColor: '#C05138',
			fruitShape: 'round'
		}
	},
	cherry: {
		id: 'cherry',
		habit: 'deciduous',
		foliage: 'broadleaf',
		lifespan: 'medium',
		waterAffinity: 0.6,
		seedKind: 'stone',
		stageMs: { sprout: 12 * HOUR, seedling: 2 * DAY, young: 7 * DAY, mature: 16 * DAY },
		size: { matureHeightM: 12, halfHeightYears: 3, girthCmPerYear: 2 },
		phenology: {
			// 花期很短 (§12.1): a single natural month ≈ 2.5 real days of blossom —
			// exactly the "call your friends over" window.
			bloomMonths: [4],
			fruitMonths: [],
			autumnColorMonths: [10, 11],
			leafFallMonths: [11],
			bareMonths: [12, 1, 2]
		},
		fruitCount: [0, 0],
		wildSeedWeight: 3,
		drop: { ...BASE_DROP, fruit: 0 },
		visual: {
			archetype: 'broad',
			crown: 1.18,
			crownHeight: 0.8,
			trunkWidth: 0.88,
			leaf: { spring: '#E9BFCB', summer: '#5C8763', autumn: '#C98A4B' },
			leaf2: { spring: '#F3D9E0', summer: '#719B76', autumn: '#DAA463' },
			blossomColor: '#E9BFCB',
			petalFall: true
		}
	},
	ginkgo: {
		id: 'ginkgo',
		habit: 'deciduous',
		foliage: 'fan',
		lifespan: 'very_long',
		waterAffinity: 0.4,
		seedKind: 'naked',
		stageMs: { sprout: 24 * HOUR, seedling: 3 * DAY, young: 10 * DAY, mature: 21 * DAY },
		size: { matureHeightM: 30, halfHeightYears: 12, girthCmPerYear: 2.2 },
		phenology: {
			bloomMonths: [],
			fruitMonths: [],
			autumnColorMonths: [10, 11],
			leafFallMonths: [11],
			bareMonths: [12, 1, 2]
		},
		fruitCount: [0, 0],
		wildSeedWeight: 2,
		drop: { ...BASE_DROP, fruit: 0, seed: 1.6 },
		visual: {
			archetype: 'fan',
			crown: 1,
			crownHeight: 1,
			trunkWidth: 0.85,
			leaf: { spring: '#A9BE7C', summer: '#7FA05C', autumn: '#D9A441' },
			leaf2: { spring: '#BDCE93', summer: '#93B171', autumn: '#E6BC61' }
		}
	},
	oak: {
		id: 'oak',
		habit: 'deciduous',
		foliage: 'broadleaf',
		lifespan: 'very_long',
		waterAffinity: 0.5,
		seedKind: 'nut',
		stageMs: { sprout: 24 * HOUR, seedling: 3 * DAY, young: 10 * DAY, mature: 21 * DAY },
		size: { matureHeightM: 28, halfHeightYears: 12, girthCmPerYear: 2.5 },
		phenology: {
			bloomMonths: [],
			fruitMonths: [9, 10, 11],
			autumnColorMonths: [10, 11],
			leafFallMonths: [11],
			bareMonths: [12, 1, 2]
		},
		fruitCount: [4, 6],
		wildSeedWeight: 2,
		drop: { ...BASE_DROP, seed: 1.6 },
		visual: {
			archetype: 'broad',
			crown: 1.22,
			crownHeight: 1.02,
			trunkWidth: 1.35,
			leaf: { spring: '#7C9A62', summer: '#46704B', autumn: '#A9803F' },
			leaf2: { spring: '#90AC78', summer: '#5A8560', autumn: '#BB945A' },
			fruitColor: '#8A6B42',
			fruitShape: 'acorn'
		}
	},
	pine: {
		id: 'pine',
		habit: 'evergreen',
		foliage: 'needleleaf',
		lifespan: 'long',
		waterAffinity: 0.3,
		seedKind: 'cone',
		stageMs: { sprout: 18 * HOUR, seedling: 60 * HOUR, young: 8 * DAY, mature: 18 * DAY },
		size: { matureHeightM: 30, halfHeightYears: 10, girthCmPerYear: 2.4 },
		phenology: {
			bloomMonths: [],
			// Cones ride the fruit window purely as visuals + shake seed boost
			// (fruitCount stays [0,0]: pines never hang pickable fruit).
			fruitMonths: [9, 10, 11],
			autumnColorMonths: [],
			leafFallMonths: [],
			bareMonths: []
		},
		fruitCount: [0, 0],
		wildSeedWeight: 3,
		drop: { ...BASE_DROP, fruit: 0, seed: 1.8, leaf: 2 },
		visual: {
			archetype: 'conifer',
			crown: 1,
			crownHeight: 1,
			trunkWidth: 1,
			leaf: { spring: '#3E6353', summer: '#3E6353', autumn: '#3E6353', winter: '#3E6353' },
			leaf2: { spring: '#4F7563', summer: '#4F7563', autumn: '#4F7563', winter: '#4F7563' },
			fruitColor: '#7A6248',
			fruitShape: 'cone'
		}
	},
	// --- Second catalog batch (§12.1 目录长期扩充): the slow, long-lived and
	// precious trees. All five are data-only additions — no engine branch.
	redwood: {
		id: 'redwood',
		habit: 'evergreen',
		foliage: 'needleleaf',
		lifespan: 'very_long',
		// Coast redwoods drink the fog: the thirstiest tree in the catalog.
		waterAffinity: 0.9,
		seedKind: 'cone',
		stageMs: { sprout: 36 * HOUR, seedling: 4 * DAY, young: 14 * DAY, mature: 30 * DAY },
		size: { matureHeightM: 90, halfHeightYears: 25, girthCmPerYear: 4 },
		phenology: {
			bloomMonths: [],
			// Cones ride the window as visuals + the shake seed boost; the
			// world's tallest tree hangs the world's smallest cone.
			fruitMonths: [9, 10, 11],
			autumnColorMonths: [],
			leafFallMonths: [],
			bareMonths: []
		},
		fruitCount: [0, 0],
		wildSeedWeight: 1,
		drop: { ...BASE_DROP, fruit: 0, seed: 1.8, leaf: 2 },
		visual: {
			archetype: 'conifer',
			// Narrow crown, enormous height: the redwood silhouette.
			crown: 0.78,
			crownHeight: 1.42,
			trunkWidth: 1.6,
			leaf: { spring: '#35564A', summer: '#35564A', autumn: '#35564A', winter: '#35564A' },
			leaf2: { spring: '#456A59', summer: '#456A59', autumn: '#456A59', winter: '#456A59' },
			fruitColor: '#8A5F3C',
			fruitShape: 'cone'
		}
	},
	bodhi: {
		id: 'bodhi',
		habit: 'evergreen',
		foliage: 'broadleaf',
		lifespan: 'very_long',
		waterAffinity: 0.6,
		seedKind: 'pip',
		stageMs: { sprout: 16 * HOUR, seedling: 60 * HOUR, young: 8 * DAY, mature: 18 * DAY },
		size: { matureHeightM: 25, halfHeightYears: 8, girthCmPerYear: 3 },
		phenology: {
			// A fig blooms INSIDE its fruit (§12.3 树木信息): no visible blossom
			// window, ever — the figs themselves are the flowering.
			bloomMonths: [],
			fruitMonths: [9, 10],
			autumnColorMonths: [],
			leafFallMonths: [],
			bareMonths: []
		},
		fruitCount: [4, 7],
		wildSeedWeight: 1,
		drop: BASE_DROP,
		visual: {
			archetype: 'broad',
			crown: 1.35,
			crownHeight: 0.9,
			trunkWidth: 1.45,
			leaf: {
				spring: '#6E9A63',
				summer: '#4C7A52',
				autumn: '#568057',
				winter: '#4C7A52'
			},
			leaf2: {
				spring: '#89B07C',
				summer: '#628F66',
				autumn: '#6D956C',
				winter: '#628F66'
			},
			fruitColor: '#7A4F63',
			fruitShape: 'round'
		}
	},
	cypress: {
		id: 'cypress',
		habit: 'evergreen',
		foliage: 'needleleaf',
		lifespan: 'very_long',
		waterAffinity: 0.25,
		seedKind: 'cone',
		stageMs: { sprout: 24 * HOUR, seedling: 4 * DAY, young: 12 * DAY, mature: 24 * DAY },
		size: { matureHeightM: 25, halfHeightYears: 12, girthCmPerYear: 2 },
		phenology: {
			bloomMonths: [],
			fruitMonths: [10, 11],
			autumnColorMonths: [],
			leafFallMonths: [],
			bareMonths: []
		},
		fruitCount: [0, 0],
		wildSeedWeight: 1,
		drop: { ...BASE_DROP, fruit: 0, seed: 1.6, leaf: 2 },
		visual: {
			archetype: 'conifer',
			// Columnar: the cypress reads as a single upward stroke.
			crown: 0.52,
			crownHeight: 1.3,
			trunkWidth: 0.8,
			leaf: { spring: '#3B5A45', summer: '#3B5A45', autumn: '#3B5A45', winter: '#3B5A45' },
			leaf2: { spring: '#4C6B53', summer: '#4C6B53', autumn: '#4C6B53', winter: '#4C6B53' },
			fruitColor: '#6E6047',
			fruitShape: 'cone'
		}
	},
	blackwood: {
		id: 'blackwood',
		habit: 'deciduous',
		foliage: 'broadleaf',
		lifespan: 'long',
		waterAffinity: 0.2,
		seedKind: 'pod',
		// Famously the slowest tree there is — decades to a usable trunk. It
		// sits at the catalog's patient end, just inside the §4.1 pacing cap.
		stageMs: { sprout: 30 * HOUR, seedling: 5 * DAY, young: 16 * DAY, mature: 40 * DAY },
		size: { matureHeightM: 12, halfHeightYears: 15, girthCmPerYear: 0.9 },
		phenology: {
			bloomMonths: [4, 5],
			fruitMonths: [9, 10],
			autumnColorMonths: [10],
			leafFallMonths: [11],
			bareMonths: [12, 1]
		},
		// Pods, not fruit: nothing to pick, seeds come from shaking (like pine).
		fruitCount: [0, 0],
		wildSeedWeight: 0.6,
		drop: { ...BASE_DROP, fruit: 0, seed: 1.5 },
		visual: {
			archetype: 'broad',
			crown: 0.82,
			crownHeight: 0.72,
			trunkWidth: 1.15,
			leaf: { spring: '#8AA173', summer: '#6E8C5E', autumn: '#A79459' },
			leaf2: { spring: '#9DB187', summer: '#82A071', autumn: '#BBA871' },
			blossomColor: '#EFEDE2',
			fruitColor: '#5F5138',
			fruitShape: 'acorn'
		}
	},
	huanghuali: {
		id: 'huanghuali',
		habit: 'deciduous',
		foliage: 'broadleaf',
		lifespan: 'very_long',
		waterAffinity: 0.45,
		seedKind: 'pod',
		stageMs: { sprout: 28 * HOUR, seedling: 4 * DAY, young: 14 * DAY, mature: 36 * DAY },
		size: { matureHeightM: 18, halfHeightYears: 15, girthCmPerYear: 1 },
		phenology: {
			bloomMonths: [4, 5],
			fruitMonths: [10, 11],
			autumnColorMonths: [11],
			// Half-deciduous: it sheds late and stands bare only briefly, then
			// flushes new leaves and flowers together.
			leafFallMonths: [12],
			bareMonths: [1, 2]
		},
		fruitCount: [0, 0],
		wildSeedWeight: 0.6,
		drop: { ...BASE_DROP, fruit: 0, seed: 1.5 },
		visual: {
			archetype: 'broad',
			crown: 1.08,
			crownHeight: 1.05,
			trunkWidth: 1,
			leaf: { spring: '#93A860', summer: '#6F8F4E', autumn: '#C2A64F' },
			leaf2: { spring: '#A8BA79', summer: '#849F63', autumn: '#D2BB74' },
			blossomColor: '#F4EEDA',
			fruitColor: '#7A6A46',
			fruitShape: 'acorn'
		}
	}
})

export const GROVE_SPECIES_IDS: readonly string[] = Object.freeze(Object.keys(GROVE_SPECIES))

/** First-tree starter choices (§7.1), one line each: 苹果会结果 / 樱花会开花 /
 * 松树四季常青 / 红杉长得最高 / 柏树笔直长寿. Everything else in the catalog
 * arrives as a seed — from a friend, or from the wild wind (§15.1). */
export const GROVE_STARTER_SPECIES: readonly string[] = [
	'apple',
	'cherry',
	'pine',
	'redwood',
	'cypress'
]

export function speciesOf(speciesId: string): SpeciesDef {
	const def = GROVE_SPECIES[speciesId]
	if (!def) {
		throw new AlinkCoreError('GROVE_SPECIES_UNKNOWN', `Unknown grove species: ${speciesId}`)
	}
	return def
}

/**
 * Catalog admission gate #1 (TD-1): structural invariants every species entry
 * must satisfy. Runs against the whole catalog in tests so a future data-file
 * catalog inherits the gate unchanged.
 */
export function validateSpeciesDef(def: SpeciesDef): void {
	const fail = (message: string): never => {
		throw new AlinkCoreError('GROVE_SPECIES_INVALID', `Species ${def.id}: ${message}`)
	}
	if (!/^[a-z][a-z0-9_]{1,31}$/.test(def.id)) fail('id must be a short lowercase slug')
	const clock = def.stageMs
	if (!(
		clock.sprout > 0 &&
		clock.seedling > clock.sprout &&
		clock.young > clock.seedling &&
		clock.mature > clock.young
	)) {
		fail('stageMs must be strictly increasing from sprout to mature')
	}
	if (clock.mature > 45 * DAY) fail('maturity beyond 45 real days breaks §4.1 pacing')
	const size = def.size
	if (!(size.matureHeightM > 0 && size.matureHeightM <= 120)) {
		fail('matureHeightM must be a real tree height in metres')
	}
	if (!(size.halfHeightYears > 0)) fail('halfHeightYears must be positive')
	if (!(size.girthCmPerYear > 0 && size.girthCmPerYear <= 10)) {
		fail('girthCmPerYear must be a plausible yearly ring')
	}
	const monthLists = [
		def.phenology.bloomMonths,
		def.phenology.fruitMonths,
		def.phenology.autumnColorMonths,
		def.phenology.leafFallMonths,
		def.phenology.bareMonths
	]
	for (const months of monthLists) {
		for (const month of months) {
			if (!Number.isInteger(month) || month < 1 || month > 12) fail(`bad month ${month}`)
		}
		if (new Set(months).size !== months.length) fail('duplicate months in phenology list')
	}
	if (def.habit === 'evergreen' && def.phenology.bareMonths.length > 0) {
		fail('evergreens never stand bare')
	}
	if (def.phenology.bloomMonths.length >= 12 || def.phenology.fruitMonths.length >= 12) {
		fail('bloom/fruit windows must leave at least one closed month')
	}
	const bare = new Set(def.phenology.bareMonths)
	for (const month of def.phenology.bloomMonths) {
		if (bare.has(month)) fail('a bare tree cannot bloom')
	}
	for (const month of def.phenology.fruitMonths) {
		if (bare.has(month)) fail('a bare tree cannot carry fruit')
	}
	// §4.1 一次只穿一季: blossom and a hanging crop are different moments of the
	// same year, never the same month. The engine leans on this — it is what
	// makes `blooming` and `fruiting` mutually exclusive for every species.
	const fruitWindow = new Set(def.phenology.fruitMonths)
	for (const month of def.phenology.bloomMonths) {
		if (fruitWindow.has(month)) fail('bloom and fruit windows must not overlap')
	}
	const [minFruit, maxFruit] = def.fruitCount
	if (!(
		Number.isInteger(minFruit) &&
		Number.isInteger(maxFruit) &&
		minFruit >= 0 &&
		maxFruit >= minFruit
	)) {
		fail('fruitCount must be an ordered non-negative integer pair')
	}
	if (maxFruit > 0 && def.phenology.fruitMonths.length === 0) {
		fail('pickable fruit requires a fruit window')
	}
	if (maxFruit > 0 && def.drop.fruit <= 0) {
		fail('pickable fruit requires a fruit drop weight')
	}
	if (maxFruit === 0 && def.drop.fruit > 0) {
		fail('fruit drop weight without pickable fruit')
	}
	const weights = Object.values(def.drop)
	if (weights.some((w) => !(Number.isFinite(w) && w >= 0))) fail('drop weights must be >= 0')
	if (def.drop.leaf + def.drop.nothing + def.drop.fact <= 0) {
		fail('unconditional drop pool must not be empty')
	}
	if (!(def.waterAffinity >= 0 && def.waterAffinity <= 1)) fail('waterAffinity must be 0..1')
	if (!(Number.isFinite(def.wildSeedWeight) && def.wildSeedWeight >= 0)) {
		fail('wildSeedWeight must be a finite weight >= 0')
	}
}

// ---------------------------------------------------------------------------
// Life-stage clock (§4.1) and the first-tree welcome show (§7.2 初生时间)

/** One-time accelerated birth for each user's FIRST tree only: 10s to sprout,
 * 5min seedling, 1h young, 6h mature — so the first bloom/fruit lands on day
 * one. All species share the welcome clock (it is theatre, not biology). */
export const FIRST_TREE_STAGE_MS: StageClock = {
	sprout: 10_000,
	seedling: 300_000,
	young: HOUR,
	mature: 6 * HOUR
}
/** First leaf unfurls at 1 minute (§7.2), inside the sprout stage. */
export const FIRST_TREE_FIRST_LEAF_MS = 60_000
/** First natural event reaches the first-day grove at 30 minutes (§7.2). */
export const FIRST_TREE_FIRST_EVENT_MS = 30 * 60_000

export function stageClockFor(def: SpeciesDef, firstTree: boolean): StageClock {
	return firstTree ? FIRST_TREE_STAGE_MS : def.stageMs
}

/** Life stage from elapsed time (threshold-inclusive, mirroring WP-G0). */
export function stageOf(
	def: SpeciesDef,
	plantedAt: number,
	now: number,
	firstTree: boolean
): TreeStage {
	const clock = stageClockFor(def, firstTree)
	const elapsed = now - plantedAt
	if (elapsed >= clock.mature) return 'mature'
	if (elapsed >= clock.young) return 'young'
	if (elapsed >= clock.seedling) return 'seedling'
	if (elapsed >= clock.sprout) return 'sprout'
	return 'seed'
}

/** How big a tree is right now, in whole centimetres (§4.1 自然属性).
 *
 * Both numbers ride the SEASON clock, like everything else about a tree's life:
 * one real day is twelve natural ones, so a grove watched for eight real years
 * holds century-old trees — and «第 96 年» only lands once a reader can also see
 * what a century did to the trunk.
 *
 * A seed underground has no size to report (both 0); the app shows the line
 * only once there is something above the ground to measure. */
export interface TreeSize {
	heightCm: number
	/** Trunk circumference — 树围/干围, the number foresters actually quote. */
	girthCm: number
}

/**
 * The height a tree of this stage is AT LEAST, whatever the calendar says.
 *
 * ⚠️ Load-bearing, not polish. The two clocks disagree on purpose (§4.1: the
 * life-stage clock is compressed per species, the season clock is a flat 12×),
 * and the first tree compresses hardest of all — it is a 幼树 within the hour
 * (§7.2). Measured on the season clock alone that tree stands **one centimetre
 * tall**, which is the day-one grove telling its owner their young apple tree
 * is the size of a fingernail while the picture above it says otherwise.
 * Species-independent on purpose: a sapling is a sapling: it is the CURVE that
 * knows a redwood from an apple, and it takes over the moment it climbs past.
 */
const STAGE_MIN_HEIGHT_CM: Readonly<Record<TreeStage, number>> = Object.freeze({
	seed: 0,
	sprout: 5,
	seedling: 25,
	young: 80,
	mature: 150
})

export function treeSizeOf(def: SpeciesDef, elapsedMs: number, stage: TreeStage): TreeSize {
	if (stage === 'seed') return { heightCm: 0, girthCm: 0 }
	const years = Math.max(0, elapsedMs) / GROVE_YEAR_MS
	const heightCm = Math.max(
		STAGE_MIN_HEIGHT_CM[stage],
		(def.size.matureHeightM * 100 * years) / (years + def.size.halfHeightYears)
	)
	// The 2% of height keeps a first-week whip from reporting a hairline trunk;
	// by the time the tree is old it is noise next to the yearly ring.
	const girthCm = def.size.girthCmPerYear * years + heightCm * 0.02
	return {
		heightCm: Math.max(1, Math.round(heightCm)),
		girthCm: Math.max(1, Math.round(girthCm))
	}
}

/** A tree goes quiet (安静/休眠 — never "dead", §12.2) when nobody has cared
 * for it for a real month. Planting counts as care. */
export const TREE_QUIET_AFTER_MS = 30 * DAY

// ---------------------------------------------------------------------------
// Tree state (the generic phenology machine)

export interface TreeStateInput {
	speciesId: string
	plantedAt: number
	/** Welcome-show tree (§7.2): exactly one per user, ever. */
	firstTree: boolean
	/** Latest care event (water/shake/pick/message/plant) timestamp. */
	lastCareAt?: number | null
	now: number
}

/** The four shows a tree's calendar can put on (§7.2 欢迎演出 picks one of
 * them): blossom, a pickable crop, cones, or the golden turn. */
export type GroveFlourish = 'bloom' | 'fruit' | 'cone' | 'gold'

export interface TreeState {
	speciesId: string
	stage: TreeStage
	/** Whole UTC-day age, day of planting = 0. */
	ageDays: number
	season: GroveSeason
	/** The season this tree is DRAWN in — the grove's season, except during a
	 * welcome show that the sky itself cannot stage (§7.2), when the tree wears
	 * the one season its show belongs to. Painters read this; everything else
	 * reads `season`. */
	visualSeason: GroveSeason
	month: number
	/** Fruiting round key while fruiting (grove year), else null. */
	fruitRound: number | null
	blooming: boolean
	fruiting: boolean
	/** Wearing a crop that cannot be picked — pine and cypress cones (§12.1).
	 * The other half of the fruit window: `fruiting` is the branch with
	 * `fruitCount > 0`, this is the branch without. It exists because the
	 * painter already draws these (the needle archetype hangs cones through
	 * autumn) and nothing could name them, so the one show three of the five
	 * starter species can ever put on was invisible to every reader. */
	coneBearing: boolean
	autumnColor: boolean
	leafFalling: boolean
	bare: boolean
	quiet: boolean
	/** One-time welcome flourish (§7.2 当天第一次开花或结果): the show the first
	 * tree wears on its maturing UTC day — the sky's own if a window is open,
	 * otherwise the next one its calendar would have opened. */
	welcomeFlourish: GroveFlourish | null
	/** 尺寸 (§4.1), whole centimetres; both 0 while the seed is still under the
	 * ground. Derived, never stored — species + elapsed time is all it takes. */
	heightCm: number
	girthCm: number
}

interface PhenologyWindow {
	kind: GroveFlourish
	months: readonly number[]
}

/** Every show a species' calendar can put on, ranked by how much of the tree
 * it takes over when two windows share a month (a crop outranks the leaf
 * color it ripens under). Data only — no species branches. */
function phenologyWindows(def: SpeciesDef): PhenologyWindow[] {
	const windows: PhenologyWindow[] = []
	if (def.phenology.bloomMonths.length > 0) {
		windows.push({ kind: 'bloom', months: def.phenology.bloomMonths })
	}
	// A species whose crop is not pickable (pine cones, §12.1) still wears its
	// fruit window — it just wears it as cones.
	if (def.phenology.fruitMonths.length > 0) {
		windows.push({
			kind: def.fruitCount[1] > 0 ? 'fruit' : 'cone',
			months: def.phenology.fruitMonths
		})
	}
	if (def.phenology.autumnColorMonths.length > 0) {
		windows.push({ kind: 'gold', months: def.phenology.autumnColorMonths })
	}
	return windows
}

/**
 * The welcome show (§7.2) for a tree maturing in natural `month`: the window
 * the sky is ALREADY holding open, else the next one this species' own
 * calendar reaches — WITH the month that window opens on, so the picture can
 * be drawn in the show's own season (TD-8: one truth, two painters) instead of
 * a hardcoded season per kind. Every catalog species has at least one window,
 * so nobody's first day is empty; null is reserved for a species with none.
 */
export function welcomeShowFor(
	def: SpeciesDef,
	month: number
): { kind: GroveFlourish; month: number } | null {
	const windows = phenologyWindows(def)
	for (let step = 0; step < 12; step += 1) {
		const at = ((month - 1 + step) % 12) + 1
		for (const window of windows) {
			if (window.months.includes(at)) return { kind: window.kind, month: at }
		}
	}
	return null
}

export function welcomeFlourishKind(def: SpeciesDef, month: number): GroveFlourish | null {
	return welcomeShowFor(def, month)?.kind ?? null
}

export function computeTreeState(input: TreeStateInput): TreeState {
	const def = speciesOf(input.speciesId)
	const stage = stageOf(def, input.plantedAt, input.now, input.firstTree)
	const month = groveMonthOf(input.now)
	const season = seasonOfMonth(month)
	const grown = stage === 'mature'
	const inMonths = (months: readonly number[]) => months.includes(month)

	let blooming = grown && inMonths(def.phenology.bloomMonths)
	// `fruiting` means a pickable crop hangs (§8.4): species with fruitCount 0
	// (pine cones, ginkgo leaves) use their fruit window only for visuals and
	// the shake seed boost — they never enter the picking state.
	let fruiting = grown && def.fruitCount[1] > 0 && inMonths(def.phenology.fruitMonths)
	// The same window, the other branch (§12.1 pines never hang pickable fruit).
	let coneBearing = grown && def.fruitCount[1] === 0 && inMonths(def.phenology.fruitMonths)
	let fruitRound: number | null = fruiting ? groveYearOf(input.now) : null
	let autumnColor = stage !== 'seed' && inMonths(def.phenology.autumnColorMonths)
	let leafFalling = grown && inMonths(def.phenology.leafFallMonths)
	// Only grown silhouettes stand visibly bare; sprouts and seedlings keep
	// their little leaves through winter (WP-G0 visual language).
	let bare = (stage === 'young' || stage === 'mature') && inMonths(def.phenology.bareMonths)
	let visualSeason = season
	let welcomeFlourish: GroveFlourish | null = null
	if (input.firstTree && grown) {
		const maturedAt = input.plantedAt + FIRST_TREE_STAGE_MS.mature
		if (utcDayOf(input.now) === utcDayOf(maturedAt)) {
			// The show is decided by the month the tree was BORN into — the same
			// month growthMilestonesBetween stamps its milestone with. A natural
			// month is only ~2.5 real days, so the welcome DAY can outlive it.
			const bornMonth = groveMonthOf(maturedAt)
			const show = welcomeShowFor(def, bornMonth)
			welcomeFlourish = show?.kind ?? null
			// §4.1 时间可以加速，但不改变基本自然逻辑: the sky always wins. The
			// welcome show only fills an EMPTY sky — it never hangs blossom on a
			// tree that is already carrying a crop. When a window is open the
			// tree simply wears the season it was born into, and that season is
			// the welcome show. Asked at BOTH months, so a month boundary inside
			// the welcome day can never make the state claim a fruit round the
			// DO did not materialize.
			const skyStagedAt = (at: number) =>
				def.phenology.bloomMonths.includes(at) ||
				(def.fruitCount[1] > 0 && def.phenology.fruitMonths.includes(at)) ||
				def.phenology.autumnColorMonths.includes(at)
			if (show && !blooming && !fruiting && !autumnColor && !skyStagedAt(bornMonth)) {
				// A tree standing in its own one-day season is neither bare nor
				// shedding, whatever month the grove is in.
				leafFalling = false
				bare = false
				visualSeason = seasonOfMonth(show.month)
				if (show.kind === 'bloom') blooming = true
				else if (show.kind === 'fruit') {
					fruiting = true
					fruitRound = WELCOME_FRUIT_ROUND
				} else if (show.kind === 'gold') autumnColor = true
				// 'cone' hangs nothing pickable, but it is still a show — the
				// visual season carries the picture, this carries the name.
				else if (show.kind === 'cone') coneBearing = true
			}
		}
	}

	const lastCareAt = Math.max(input.plantedAt, input.lastCareAt ?? 0)
	return {
		speciesId: def.id,
		stage,
		ageDays: Math.max(0, utcDayOf(input.now) - utcDayOf(input.plantedAt)),
		season,
		visualSeason,
		month,
		fruitRound,
		blooming,
		fruiting,
		coneBearing,
		autumnColor,
		leafFalling,
		bare,
		quiet: input.now - lastCareAt >= TREE_QUIET_AFTER_MS,
		welcomeFlourish,
		// Measured from the real elapsed time, not the whole-day `ageDays`: a
		// natural day is two real hours, so a sapling visibly puts on height
		// between a morning and an evening visit.
		...treeSizeOf(def, input.now - input.plantedAt, stage)
	}
}

// ---------------------------------------------------------------------------
// What a grove is doing right now, in one word (§15.2 林间散步 / sprite §7.4
// 带回来). Two surfaces ask this same question — a human walking the forest and
// a sprite looking around somewhere it has gone — so the vocabulary and its
// order live here once, and each surface adds only the term the other has no
// use for (a thirsty tree means nothing to a walker who cannot water it from
// the road; an open guest plot means nothing to a sprite that cannot ask).

/** The four shows a grove can be wearing, ranked by how much of the place they
 * take over.
 *
 * NOT the same ranking as `phenologyWindows`, and the difference is deliberate:
 * that one ranks the windows of ONE tree, where a crop outranks the leaf colour
 * it ripens under, so `cone` sits above `gold`. This one ranks what a whole
 * grove is worth crossing the forest for, and a canopy turning gold takes over
 * more of a place than cones a reader has to walk up to a branch to notice. */
export type GroveSpectacle = 'blooming' | 'fruiting' | 'gold' | 'cones'

/** The fields either painter needs; both `TreeState` and the sprite's flatter
 * look-view satisfy it structurally. */
export interface TreeShowState {
	stage: string
	blooming: boolean
	fruiting: boolean
	coneBearing: boolean
	autumnColor: boolean
}

/**
 * The order is the load-bearing part: **奇观 > 可行动 > 刚发芽**.
 *
 * A spectacle is a reason to walk over and look; an actionable state is a
 * reason to walk over and do something; a sprout asks nothing of the reader at
 * all. Sprouting used to be checked FIRST, which meant a single seedling
 * anywhere in a grove silenced a place standing in full autumn gold — and
 * during any stretch where lots of people are planting (exactly the stretch
 * where these lines matter most) that was nearly every grove.
 */
export function spectacleOf(trees: readonly TreeShowState[]): GroveSpectacle | null {
	if (trees.some((tree) => tree.blooming)) return 'blooming'
	if (trees.some((tree) => tree.fruiting)) return 'fruiting'
	// Gold needs a canopy. `autumnColor` is true of anything past seed — a
	// two-leaf sprout in month 10 really is drawn in autumn colours — but
	// «这片林子正在转金» is a claim about a crown, and it is the only one of the
	// four not already gated on `grown` where it is computed. Saying it of a
	// seedling would send someone across the forest to look at nothing.
	if (trees.some((tree) => tree.autumnColor && hasCanopy(tree.stage))) return 'gold'
	if (trees.some((tree) => tree.coneBearing)) return 'cones'
	return null
}

function hasCanopy(stage: string): boolean {
	return stage === 'young' || stage === 'mature'
}

/** The weakest line, and therefore the last one: something here is very new. */
export function hasSprouting(trees: readonly { stage: string }[]): boolean {
	return trees.some((tree) => tree.stage === 'sprout' || tree.stage === 'seedling')
}

// ---------------------------------------------------------------------------
// Growth milestones (树记补写, TD-1): everything that happened between two
// reads, stamped with the real moment the growth function says it occurred.

export type GrowthMilestoneKind =
	| 'sprouted'
	| 'first_leaf'
	| 'seedling'
	| 'young'
	| 'matured'
	| 'welcome_flourish'
	| 'bloom_started'
	| 'fruit_started'

export interface GrowthMilestone {
	kind: GrowthMilestoneKind
	at: number
	/** Fruiting round key (dedupe anchor in the DO) for the two milestones that
	 * hang a crop: fruit_started, and a welcome_flourish that bears fruit — the
	 * real grove year when the sky's own window is open at maturity, else
	 * WELCOME_FRUIT_ROUND for the one-time welcome crop. */
	fruitRound?: number
	/** Which show for welcome_flourish. */
	flourish?: GroveFlourish
}

/** True when `month` opens a consecutive phenology run (its predecessor, with
 * 12→1 wrap, is not in the list) — one story event per window, not per month. */
function opensWindow(months: readonly number[], month: number): boolean {
	if (!months.includes(month)) return false
	const previous = month === 1 ? 12 : month - 1
	return !months.includes(previous)
}

/**
 * All milestones with `fromExclusive < at <= toInclusive`, sorted by time.
 * The DO calls this on every read with (lastComputedAt, now] and appends the
 * result to the tree story — the lazy-settlement heart of TD-1.
 */
export function growthMilestonesBetween(
	input: Omit<TreeStateInput, 'now'>,
	fromExclusive: number,
	toInclusive: number
): GrowthMilestone[] {
	const def = speciesOf(input.speciesId)
	if (!(toInclusive > fromExclusive)) return []
	const clock = stageClockFor(def, input.firstTree)
	const out: GrowthMilestone[] = []
	const within = (at: number) => at > fromExclusive && at <= toInclusive

	const stageKinds: ReadonlyArray<[Exclude<TreeStage, 'seed'>, GrowthMilestoneKind]> = [
		['sprout', 'sprouted'],
		['seedling', 'seedling'],
		['young', 'young'],
		['mature', 'matured']
	]
	for (const [stage, kind] of stageKinds) {
		const at = input.plantedAt + clock[stage]
		if (within(at)) out.push({ kind, at })
	}
	if (input.firstTree) {
		const leafAt = input.plantedAt + FIRST_TREE_FIRST_LEAF_MS
		if (within(leafAt)) out.push({ kind: 'first_leaf', at: leafAt })
		const maturedAt = input.plantedAt + FIRST_TREE_STAGE_MS.mature
		const flourish = welcomeFlourishKind(def, groveMonthOf(maturedAt))
		if (flourish && within(maturedAt)) {
			const milestone: GrowthMilestone = { kind: 'welcome_flourish', at: maturedAt, flourish }
			if (flourish === 'fruit') {
				// In season the welcome show IS the year's real crop (real round,
				// real window expiry) — the sky was already holding the window
				// open. Out of season it hangs the one-time welcome crop.
				milestone.fruitRound =
					fruitWindowEndMs(def, maturedAt) === null ? WELCOME_FRUIT_ROUND : groveYearOf(maturedAt)
			}
			out.push(milestone)
		}
	}

	// Seasonal windows only open on mature trees. A window's start for THIS
	// tree is the later of its opening-month start and the maturity moment (a
	// tree maturing mid-window starts blooming/fruiting right then).
	const maturedAt = input.plantedAt + clock.mature
	if (toInclusive > maturedAt) {
		const flourish = input.firstTree ? welcomeFlourishKind(def, groveMonthOf(maturedAt)) : null
		const windows: ReadonlyArray<[readonly number[], 'bloom_started' | 'fruit_started']> = [
			[def.phenology.bloomMonths, 'bloom_started'],
			// Same pickable-crop gate as TreeState.fruiting.
			[def.fruitCount[1] > 0 ? def.phenology.fruitMonths : [], 'fruit_started']
		]
		// Scan one grove year before the range so a run that opened earlier but
		// clamps to maturedAt inside the range is still found.
		const firstYear = groveYearOf(Math.max(maturedAt, fromExclusive)) - 1
		const lastYear = groveYearOf(toInclusive)
		for (const [months, kind] of windows) {
			if (months.length === 0) continue
			for (let year = firstYear; year <= lastYear; year += 1) {
				for (let month = 1; month <= 12; month += 1) {
					if (!opensWindow(months, month)) continue
					const runStart = groveMonthStartMs(year, month)
					const runEnd = windowRunEndMs(months, year, month)
					const startAt = Math.max(runStart, maturedAt)
					if (startAt >= runEnd || !within(startAt)) continue
					// The welcome flourish already tells this story at maturity.
					if (
						startAt === maturedAt &&
						flourish === (kind === 'bloom_started' ? 'bloom' : 'fruit')
					) {
						continue
					}
					if (kind === 'fruit_started') {
						out.push({ kind, at: startAt, fruitRound: groveYearOf(startAt) })
					} else {
						out.push({ kind, at: startAt })
					}
				}
			}
		}
	}

	out.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind))
	return out
}

/**
 * End of the fruit-window run containing `at` (real ms): the moment hanging
 * crops from this round quietly expire. Null when `at` sits outside the
 * species' fruit window (callers then fall back to a fixed TTL — the welcome
 * crop case).
 */
export function fruitWindowEndMs(def: SpeciesDef, at: number): number | null {
	const months = def.phenology.fruitMonths
	const month = groveMonthOf(at)
	if (!months.includes(month)) return null
	// Walk back to the run's opening month (12→1 wrap, bounded).
	let start = month
	let year = groveYearOf(at)
	for (let steps = 0; steps < 11; steps += 1) {
		const previous = start === 1 ? 12 : start - 1
		if (!months.includes(previous)) break
		if (start === 1) year -= 1
		start = previous
	}
	return windowRunEndMs(months, year, start)
}

/**
 * When the one-time welcome crop (§7.2, round WELCOME_FRUIT_ROUND) quietly
 * expires: its own TTL, or the moment the tree's real fruit window opens —
 * whichever comes first. Two crops never hang on one tree.
 */
export function welcomeCropExpiryMs(def: SpeciesDef, at: number): number {
	const ttl = at + WELCOME_FRUIT_TTL_MS
	const opening = nextFruitWindowStartMs(def, at)
	return opening === null ? ttl : Math.min(ttl, opening)
}

/** Start of the next fruit window after `at`. Callers hold a welcome crop, so
 * `at` sits outside the window and the first hit walking forward is a real
 * opening. Null for a species with no fruit window at all. */
function nextFruitWindowStartMs(def: SpeciesDef, at: number): number | null {
	const months = def.phenology.fruitMonths
	if (months.length === 0) return null
	let month = groveMonthOf(at)
	let year = groveYearOf(at)
	for (let steps = 0; steps < 12; steps += 1) {
		if (month === 12) {
			month = 1
			year += 1
		} else {
			month += 1
		}
		if (months.includes(month)) return groveMonthStartMs(year, month)
	}
	return null
}

/** Real ms when the consecutive window run opening at (year, month) closes:
 * the start of the first month after the run, with 12→1 wrap into next year. */
function windowRunEndMs(months: readonly number[], year: number, startMonth: number): number {
	let month = startMonth
	let runYear = year
	for (let steps = 0; steps < 11; steps += 1) {
		const next = month === 12 ? 1 : month + 1
		if (!months.includes(next)) break
		if (month === 12) runYear += 1
		month = next
	}
	const next = month === 12 ? 1 : month + 1
	const nextYear = month === 12 ? runYear + 1 : runYear
	return groveMonthStartMs(nextYear, next)
}

// ---------------------------------------------------------------------------
// Deterministic randomness (TD-2): hash → PRNG, replay-proof by construction.

/** FNV-1a 32-bit — stable across runtimes, good enough for drop tables. */
export function fnv1a32(value: string): number {
	let hash = 0x811c9dc5
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193)
	}
	return hash >>> 0
}

/** mulberry32 PRNG (same generator the WP-G0 prototype ships). */
export function mulberry32(seed: number): () => number {
	let t = seed >>> 0 || 1
	return () => {
		t += 0x6d2b79f5
		let r = Math.imul(t ^ (t >>> 15), 1 | t)
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296
	}
}

/** Per-tree fixed morphology seed (TD-8): every renderer derives the same
 * individual shape from the tree id alone. */
export function morphSeedOf(treeId: string): number {
	return fnv1a32(`morph|${treeId}`)
}

// ---------------------------------------------------------------------------
// Shake (§8.3, §26.2): one shake per (person, tree, UTC day); the outcome is
// sealed the moment the day starts — re-rolling is impossible by design.

export const GROVE_FACT_COUNT = 5
export const WATER_EFFECT_COUNT = 4

export interface ShakeContext {
	treeId: string
	actorId: string
	utcDay: number
	speciesId: string
	stage: TreeStage
	/** Natural month at shake time (drives seasonal modulation). */
	month: number
	/** A hanging fruit the actor may pick exists right now. */
	fruitAvailable: boolean
	/** Actor's dew ledger is below the daily cap (a shaken-loose drop helps). */
	dewBelowCap: boolean
	/** At least one visible note rests under this tree. */
	messageAvailable: boolean
}

export interface ShakeResult {
	outcome: ShakeOutcome
	/** Index into the localized tree-fact list when outcome = fact. */
	factIndex: number
	/** Raw u32 for downstream sub-picks (which message surfaced, etc.). */
	roll: number
}

/**
 * Deterministic shake settlement (TD-2). Weights come from the species drop
 * table; availability gates zero out impossible outcomes; season modulates:
 * seeds fall more readily inside the fruit window, leaves during leaf-fall.
 */
export function resolveShake(context: ShakeContext): ShakeResult {
	const def = speciesOf(context.speciesId)
	const seed = fnv1a32(`shake|${context.treeId}|${context.actorId}|${context.utcDay}`)
	const rnd = mulberry32(seed)

	const mature = context.stage === 'mature'
	const inFruitWindow = def.phenology.fruitMonths.includes(context.month)
	const inLeafFall = def.phenology.leafFallMonths.includes(context.month)

	const entries: Array<[ShakeOutcome, number]> = [
		['leaf', def.drop.leaf * (inLeafFall ? 1.5 : 1)],
		['nothing', def.drop.nothing],
		['bird', def.drop.bird],
		['fact', def.drop.fact],
		['dew', context.dewBelowCap ? def.drop.dew : 0],
		['fruit', context.fruitAvailable ? def.drop.fruit : 0],
		['seed', mature ? def.drop.seed * (inFruitWindow ? 2 : 1) : 0],
		['message', context.messageAvailable ? def.drop.message : 0]
	]
	const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
	let outcome: ShakeOutcome = 'nothing'
	if (total > 0) {
		let pick = rnd() * total
		for (const [candidate, weight] of entries) {
			pick -= weight
			if (pick <= 0 && weight > 0) {
				outcome = candidate
				break
			}
		}
	}
	const roll = Math.floor(rnd() * 4294967296)
	return { outcome, factIndex: roll % GROVE_FACT_COUNT, roll }
}

/** Which of the four gentle water responses plays (§8.2 四选一): deterministic
 * per (tree, actor, day) so replays cannot farm variety. */
export function waterEffectIndex(treeId: string, actorId: string, utcDay: number): number {
	return fnv1a32(`water|${treeId}|${actorId}|${utcDay}`) % WATER_EFFECT_COUNT
}

// ---------------------------------------------------------------------------
// Fruit rounds (§14.1)

/** Round key for the one-time first-tree welcome crop (§7.2): hangs out of
 * season, so it needs a key no natural grove year can collide with. */
export const WELCOME_FRUIT_ROUND = -1
/** Welcome-crop fruits linger this long before quietly expiring. */
export const WELCOME_FRUIT_TTL_MS = 7 * DAY

export interface FruitBatch {
	/** Hanging fruits this round (0 when the species hangs none). */
	count: number
	/** Index of the owner-reserved fruit (§14.1 主人保底果), null when count=0. */
	reservedIndex: number | null
}

/** Deterministic per-round crop: same tree, same round → same batch. */
export function rollFruitBatch(treeId: string, fruitRound: number, def: SpeciesDef): FruitBatch {
	const [min, max] = def.fruitCount
	if (max <= 0) return { count: 0, reservedIndex: null }
	const rnd = mulberry32(fnv1a32(`fruit|${treeId}|${fruitRound}`))
	const count = min + Math.floor(rnd() * (max - min + 1))
	// A species may roll an empty round (fruitCount [0, n]); an empty batch has
	// no fruit to reserve, so the owner's index must stay null.
	if (count <= 0) return { count: 0, reservedIndex: null }
	return { count, reservedIndex: Math.floor(rnd() * count) }
}

export type FruitStatus =
	'hanging' | 'picked' | 'eaten' | 'gifted' | 'placed' | 'seeded' | 'expired'

export const FRUIT_TRANSITIONS: Record<FruitStatus, readonly FruitStatus[]> = {
	hanging: ['picked', 'expired'],
	picked: ['eaten', 'gifted', 'placed', 'seeded'],
	eaten: [],
	// gifted → picked is the WP-G5 compensation edge: a gift is marked on the
	// giver FIRST, then granted to the recipient; a refused grant (blocked,
	// outage) walks the mark back. Mirrors SEED_TRANSITIONS gifted → stored.
	// gifted → placed is the far end of the same journey: whoever holds a
	// gifted fruit may hand it back under its own tree (§14.1 放回树下).
	gifted: ['picked', 'placed'],
	placed: ['picked', 'expired'],
	seeded: [],
	expired: []
}

export function canTransitionFruit(from: FruitStatus, to: FruitStatus): boolean {
	return FRUIT_TRANSITIONS[from]?.includes(to) ?? false
}

/** §14.1: the reserved fruit answers only to the land owner until the round's
 * final month ends; everything else follows the tree's pick permission. */
export function canPickFruit(input: { ownerReserved: boolean; actorIsOwner: boolean }): boolean {
	return input.actorIsOwner || !input.ownerReserved
}

/**
 * Tray-held fruit (WP-G5): a fruit picked from ANY grove mirrors into the
 * picker's own tray ledger with full provenance; its lifecycle is settled
 * there. `placed`/`gifted` reach back across groves, so both keep a revert
 * edge for the two-phase compensation walk-back.
 */
export type TrayFruitStatus = 'held' | 'eaten' | 'gifted' | 'placed' | 'seeded'

export const TRAY_FRUIT_TRANSITIONS: Record<TrayFruitStatus, readonly TrayFruitStatus[]> = {
	held: ['eaten', 'gifted', 'placed', 'seeded'],
	eaten: [],
	gifted: ['held'],
	placed: ['held'],
	seeded: []
}

export function canTransitionTrayFruit(from: TrayFruitStatus, to: TrayFruitStatus): boolean {
	return TRAY_FRUIT_TRANSITIONS[from]?.includes(to) ?? false
}

// ---------------------------------------------------------------------------
// Seeds (§14.2, §25.4)

export type SeedStatus = 'stored' | 'gifted' | 'windborne' | 'planted' | 'requested' | 'returned'

export const SEED_TRANSITIONS: Record<SeedStatus, readonly SeedStatus[]> = {
	stored: ['gifted', 'windborne', 'planted', 'requested', 'returned'],
	gifted: ['stored'],
	windborne: ['stored'],
	planted: [],
	// Locked inside a pending guest plant request (§11.2, WP-G6): the seed
	// cannot be gifted, released or planted until the owner decides. Accepted
	// consumes it (planted); declined/canceled hands it back (stored).
	requested: ['stored', 'planted'],
	returned: ['stored']
}

export function canTransitionSeed(from: SeedStatus, to: SeedStatus): boolean {
	return SEED_TRANSITIONS[from]?.includes(to) ?? false
}

// ---------------------------------------------------------------------------
// Dew ledger (§9.1, §26.1)

/**
 * 一块土地一滴晨露 (§9.1). The morning's dew is the LAND a person keeps, not a
 * number picked once: three plots, three drops. It reads the same as the old
 * flat 3 today — and it is the only version of the rule that survives a grove
 * growing, where a fixed handful would quietly have to be spread thinner over
 * every new plot.
 *
 * The guest plot is deliberately NOT counted: it is land held open for someone
 * else, and a person's own mornings should not depend on whether they left a
 * door open.
 */
export const DEW_PER_PLOT = 1

export function dailyDewFor(ownerPlotCount: number): number {
	return Math.max(1, Math.round(Math.max(0, ownerPlotCount) * DEW_PER_PLOT))
}

/** Fruit-restored dew per person per day (§26.1). */
export const DEW_FROM_FRUIT_DAILY_CAP = 1

export interface DewLedger {
	utcDay: number
	dewRemaining: number
	/** Dew restored by eating fruit today (capped). */
	dewFromFruit: number
	/** Wind settlement marker for the day (TD-5 pull-based). */
	windSeedChecked: boolean
}

/** Roll the ledger forward to `utcDay` (fresh dew each UTC day, no timers).
 * `dailyDew` is the grove's OWN cap — its land (§9.1), never a global. */
export function resolveDewLedger(
	previous: DewLedger | null,
	utcDay: number,
	dailyDew: number
): DewLedger {
	if (previous && previous.utcDay === utcDay) return previous
	return { utcDay, dewRemaining: dailyDew, dewFromFruit: 0, windSeedChecked: false }
}

/** Eating a fruit restores at most one drop per day, never past the grove's cap. */
export function applyFruitDew(ledger: DewLedger, dailyDew: number): DewLedger {
	if (ledger.dewFromFruit >= DEW_FROM_FRUIT_DAILY_CAP) return ledger
	if (ledger.dewRemaining >= dailyDew) return { ...ledger, dewFromFruit: ledger.dewFromFruit + 1 }
	return {
		...ledger,
		dewRemaining: ledger.dewRemaining + 1,
		dewFromFruit: ledger.dewFromFruit + 1
	}
}

// ---------------------------------------------------------------------------
// Weather (§4.2, TD-1): one shared deterministic sky, no tasks.

export type GroveWeatherKind = 'sun' | 'rain' | 'wind' | 'snow' | 'bloom' | 'fall'

export interface GroveWeather {
	utcDay: number
	season: GroveSeason
	kind: GroveWeatherKind
	/** Rare meteor night (§4.2 流星夜, one of the two MVP easter eggs). */
	meteorNight: boolean
}

const WEATHER_POOLS: Record<GroveSeason, readonly GroveWeatherKind[]> = {
	spring: ['bloom', 'sun', 'rain', 'wind'],
	summer: ['sun', 'rain', 'wind'],
	autumn: ['fall', 'wind', 'sun'],
	winter: ['snow', 'sun']
}

export function weatherOf(utcDay: number): GroveWeather {
	const noon = utcDay * 86_400_000 + 43_200_000
	const season = seasonOf(noon)
	const rnd = mulberry32(fnv1a32(`weather|${utcDay}`))
	const pool = WEATHER_POOLS[season]
	const kind = pool[Math.floor(rnd() * pool.length)] ?? 'sun'
	return { utcDay, season, kind, meteorNight: rnd() < 1 / 14 }
}

// ---------------------------------------------------------------------------
// Wind (§15.1, TD-5): pull-based settlement — no pushes, fully deterministic.

/** Chance an open grove receives a windborne seed on a given day. */
export const WIND_SEED_DAILY_CHANCE = 0.25
/** Same-origin grove → same recipient at most once per this many days (§26.4). */
export const WIND_SAME_ORIGIN_COOLDOWN_DAYS = 14

/** Does the wind visit this user today? Deterministic per (user, day) so the
 * answer cannot be re-rolled by reloading. */
export function windBlowsFor(userId: string, utcDay: number): boolean {
	return mulberry32(fnv1a32(`wind|${userId}|${utcDay}`))() < WIND_SEED_DAILY_CHANCE
}

/** Everything the wild wind is allowed to carry, in catalog order. Frozen
 * catalog → the pool is a constant; only a `restrictTo` call narrows it. */
const WILD_SEED_POOL: readonly SpeciesDef[] = Object.freeze(
	GROVE_SPECIES_IDS.map((id) => GROVE_SPECIES[id]!).filter((def) => def.wildSeedWeight > 0)
)

/**
 * 野风 (§15.1): which species the forest itself sends when the wind blows and
 * no released seed is waiting. Weighted by the catalog's `wildSeedWeight`, so
 * common trees arrive often and the slow rare ones stay a surprise.
 * Deterministic per (user, day) — reloading cannot re-roll the species, and a
 * new grove can be held to the simple starters.
 */
export function wildWindSpeciesFor(
	userId: string,
	utcDay: number,
	restrictTo?: readonly string[]
): string | null {
	let pool = WILD_SEED_POOL
	if (restrictTo) {
		const allowed = new Set(restrictTo)
		pool = pool.filter((def) => allowed.has(def.id))
	}
	const total = pool.reduce((sum, def) => sum + def.wildSeedWeight, 0)
	if (total <= 0) return null
	let roll = mulberry32(fnv1a32(`wildseed|${userId}|${utcDay}`))() * total
	for (const def of pool) {
		roll -= def.wildSeedWeight
		if (roll < 0) return def.id
	}
	return pool[pool.length - 1]!.id
}

// ---------------------------------------------------------------------------
// Care events, notes and guest requests (§16, §25.6, §25.8)

export type CareEventType = 'plant' | 'water' | 'shake' | 'pick' | 'gift' | 'message' | 'visit'

export const CARE_EVENT_TYPES: readonly CareEventType[] = [
	'plant',
	'water',
	'shake',
	'pick',
	'gift',
	'message',
	'visit'
]

/** Effective care for WCCT (§28.5): watering, planting, keeping a seed from a
 * pick, leaving a note — shakes and plain visits do not count. */
export const WCCT_CARE_TYPES: ReadonlySet<CareEventType> = new Set([
	'plant',
	'water',
	'pick',
	'message'
])

/** Tree-story event kinds (§16). Text renders app-side from kind + params —
 * the store never holds prose, so locales stay free. */
export type TreeStoryKind =
	| GrowthMilestoneKind
	| 'planted'
	| 'guest_planted'
	| 'guest_allowed'
	| 'watered'
	| 'first_watered'
	| 'shaken'
	| 'picked'
	| 'fruit_placed'
	| 'fruit_gifted'
	| 'seed_kept'
	| 'seed_departed'
	| 'seed_sprouted_afar'
	| 'note_left'
	| 'returned_to_planter'

export type GroveMessageStatus = 'active' | 'retracted' | 'removed'

/** §16: notes are immutable — the author may retract, the land owner may
 * remove; removed notes keep no original text anywhere. */
export function canTransitionGroveMessage(
	from: GroveMessageStatus,
	to: GroveMessageStatus,
	actor: 'author' | 'owner'
): boolean {
	if (from !== 'active') return false
	if (to === 'retracted') return actor === 'author'
	if (to === 'removed') return actor === 'owner'
	return false
}

/**
 * §27.4 sentinel for a deleted user's identity on grove read paths: planter
 * ids, story actors, note authors and lineage holders whose account no longer
 * resolves are served as this literal instead of the dangling xid, and the app
 * renders it as "一位已离开的用户". Deliberately NOT a valid xid, so it can
 * never collide with a real id. It IS a valid handle shape, though, so the word
 * also sits in RESERVED_HANDLES (ids.ts): nobody can claim al.ink/departed and
 * turn the sentinel into a slug that resolves to them.
 */
export const GROVE_DEPARTED_USER = 'departed'

/** 一句话留言 (§8.5): one gentle sentence, hard length wall (§27.1). */
export const GROVE_MESSAGE_MAX_LENGTH = 120

/** The cheap anti-ad wall (§17.4 广告): a one-line wish never needs a link,
 * and links are the whole point of grove spam. Shared by every short public
 * UGC string in the grove world — notes, grove names, and sprite form cards
 * (sprite §4.4) all walk this same wall rather than growing private copies. */
export const GROVE_LINK_PATTERN = /(?:https?:\/\/|www\.[^\s]|[^\s@]+\.(?:com|net|org|io|ai|cn)\b)/i

export function normalizeGroveMessage(text: string): string {
	const trimmed = text.replace(/\s+/g, ' ').trim()
	if (trimmed.length === 0) {
		throw new AlinkCoreError('GROVE_MESSAGE_EMPTY', 'A note needs at least one visible character.')
	}
	if (trimmed.length > GROVE_MESSAGE_MAX_LENGTH) {
		throw new AlinkCoreError(
			'GROVE_MESSAGE_TOO_LONG',
			`Notes are one small line: at most ${GROVE_MESSAGE_MAX_LENGTH} characters.`
		)
	}
	if (GROVE_LINK_PATTERN.test(trimmed)) {
		throw new AlinkCoreError('GROVE_MESSAGE_LINK', 'Notes under a tree carry words, not links.')
	}
	return trimmed
}

/**
 * 林名 (§4.4, WP-G10): a grove may carry a short display name («严家山»). A
 * title, not an address — never unique, never a handle, the URL stays
 * al.ink/<handle>/grove. Public text on the most public surfaces, so it walks
 * the same walls as one-line notes (§26.6): single line, hard length cap, the
 * link wall, and the TRIAGE content filter at the service layer.
 */
export const GROVE_NAME_MAX_LENGTH = 24

/** Normalize a grove-name input; `null` means "unnamed" (clearing is fine). */
export function normalizeGroveName(text: string): string | null {
	const trimmed = text.replace(/\s+/g, ' ').trim()
	if (trimmed.length === 0) return null
	if ([...trimmed].length > GROVE_NAME_MAX_LENGTH) {
		throw new AlinkCoreError(
			'GROVE_NAME_TOO_LONG',
			`A grove name is a short title: at most ${GROVE_NAME_MAX_LENGTH} characters.`
		)
	}
	if (GROVE_LINK_PATTERN.test(trimmed)) {
		throw new AlinkCoreError('GROVE_NAME_LINK', 'A grove name carries words, not links.')
	}
	return trimmed
}

// ---------------------------------------------------------------------------
// Footprints (§15.3 走过的林子, WP-G9): the visitor's PRIVATE revisit list,
// stored in their own GroveDO. The land owner never sees it — no visitor log,
// no counts, no notifications. Only walked-into groves are recorded (never
// public-page onlookers), and the signals beacon stays funnel-only (§31.4).

/** At most this many footprints; beyond it the oldest never-cared rows go
 * first (cared rows are evicted last, pinned rows never — §26.5). */
export const VISITED_GROVES_CAP = 60
/** «记住这片林子» pins are few and deliberate; pinned rows skip eviction. */
export const VISITED_PINNED_CAP = 12

export type GuestRequestStatus = 'pending' | 'accepted' | 'declined' | 'canceled'

/** A pending guest plant request quietly lapses after this long (WP-G6): the
 * seed goes home and the owner's badge clears — no one owes anyone an answer
 * forever. Lazily settled on DO reads, never by a timer (TD-1 discipline). */
export const GUEST_REQUEST_TTL_MS = 14 * 86_400_000

export const GUEST_REQUEST_TRANSITIONS: Record<GuestRequestStatus, readonly GuestRequestStatus[]> =
	{
		pending: ['accepted', 'declined', 'canceled'],
		accepted: [],
		declined: [],
		canceled: []
	}

export function canTransitionGuestRequest(
	from: GuestRequestStatus,
	to: GuestRequestStatus
): boolean {
	return GUEST_REQUEST_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertGuestRequestTransition(
	from: GuestRequestStatus,
	to: GuestRequestStatus
): void {
	if (!canTransitionGuestRequest(from, to)) {
		throw new AlinkCoreError(
			'GROVE_INVALID_REQUEST_TRANSITION',
			`Guest plant request cannot move ${from} → ${to}.`
		)
	}
}

/**
 * §18.1 high-priority notices (WP-G6, TD-6): the ONLY grove events that reach
 * email. GroveDO write paths record them in `pending_notices` (same
 * transaction as the triggering write, deterministic ids for once-ever
 * events); the service drains them into the outbox, and the queue consumer
 * mails the recipient. Everything else stays daily-digest / on-page (§18.2).
 */
export type GroveNoticeKind =
	| 'guest_request' // 有人请求在来客地种树 → land owner
	| 'seed_sprouted_afar' // 种子在另一片 Grove 发芽 → origin grove owner
	| 'first_visitor_water' // 第一位真实访客浇水 → land owner
	| 'first_fruit_picked' // 第一颗果实被访客摘走 → land owner
	| 'guest_tree_bloomed' // 共同树第一次开花 → owner AND planter

// ---------------------------------------------------------------------------
// Land (§10) and grove settings (§11.3, §27.3)

export const GROVE_PLOT_COUNT = 4
export const GROVE_OWNER_PLOTS: readonly number[] = [0, 1, 2]
export const GROVE_GUEST_PLOT_INDEX = 3

/** What a grove of today's size wakes up to (§9.1 一块土地一滴晨露).
 *
 * ⚠️ A DEFAULT, for callers with no grove in hand — a visitor's cap where the
 * ledger read failed, a test. Anyone holding a grove must ask THAT grove: it
 * counts its own plots, which is the whole point of the rule. Declared here,
 * below the land it is made of, because a const cannot read one declared later
 * in the module (`dailyDewFor` is a hoisted function; `GROVE_OWNER_PLOTS` is
 * not). */
export const DAILY_DEW = dailyDewFor(GROVE_OWNER_PLOTS.length)

export type PlotType = 'owner' | 'guest'
export type PlotStatus = 'empty' | 'reserved' | 'occupied'
export type TreeStatus = 'active' | 'dormant' | 'returning' | 'archived'

export function plotTypeOf(index: number): PlotType {
	if (!Number.isInteger(index) || index < 0 || index >= GROVE_PLOT_COUNT) {
		throw new AlinkCoreError('GROVE_INVALID_PLOT', `Plot index out of range: ${index}`)
	}
	return index === GROVE_GUEST_PLOT_INDEX ? 'guest' : 'owner'
}

/** §11.3 modes + `closed` (§27.2 关闭来客地 / §31.4 acceptance): a closed
 * guest plot takes no requests and never reads as open anywhere. */
export type GuestPlotMode = 'closed' | 'confirm' | 'connected_direct' | 'seed_drop'
export type GroveVisibility = 'public' | 'link_only' | 'private'

/**
 * May a stranger ask to plant a tree in this guest plot? `closed` takes
 * nothing, and a seed-drop grove takes SEEDS, not plant requests — so the two
 * of them read the same to anyone hoping to leave a tree behind.
 *
 * The one predicate, because it is the answer to one question that is asked in
 * four places: the walk index (`indexProjection`), the public read
 * (`shapePublicGrove`), the OG card, and the sprite's 第一次出门 gate.
 */
export function guestPlotTakesPlantRequests(mode: GuestPlotMode): boolean {
	return mode !== 'closed' && mode !== 'seed_drop'
}

export interface GroveSettings {
	visibility: GroveVisibility
	guestPlotMode: GuestPlotMode
	/** 林名 (§4.4, WP-G10) — a public title, or null for «某某的树林». */
	name: string | null
	/** May strangers find this grove on a forest walk (§27.3)? */
	forestDiscoverable: boolean
	/** The §26.4 user off-switch for BOTH wind directions: off = this user
	 * neither receives windborne seeds nor may release seeds into the wind. */
	windSeedEnabled: boolean
	/** Show carer identities on the public tree story (§27.3). */
	showCarers: boolean
	/** Show planter identity on guest trees (§27.3). */
	showPlanter: boolean
	/** Public seed lineage (§14.2). */
	lineagePublic: boolean
}

export const DEFAULT_GROVE_SETTINGS: GroveSettings = Object.freeze({
	visibility: 'public',
	guestPlotMode: 'confirm',
	name: null,
	forestDiscoverable: true,
	windSeedEnabled: true,
	showCarers: true,
	showPlanter: true,
	lineagePublic: true
})

// ---------------------------------------------------------------------------
// Catalog admission gate #2 (TD-1): full-year phenology simulation. Tests
// snapshot this for every catalog entry; a future species PR must land with
// its own snapshot reviewed.

export interface PhenologyMonthSample {
	month: number
	season: GroveSeason
	blooming: boolean
	fruiting: boolean
	autumnColor: boolean
	leafFalling: boolean
	bare: boolean
}

/** Simulate a mature tree of `speciesId` through all 12 natural months. */
export function simulateSpeciesYear(speciesId: string): PhenologyMonthSample[] {
	const def = speciesOf(speciesId)
	// Plant far enough back that the tree is mature for the whole simulated
	// year, and simulate a fixed grove year for stable snapshots.
	const year = 40
	const plantedAt = groveMonthStartMs(year - 2, 1) - def.stageMs.mature
	const samples: PhenologyMonthSample[] = []
	for (let month = 1; month <= 12; month += 1) {
		// Sample mid-month to dodge boundary rounding.
		const at = groveMonthStartMs(year, month) + Math.floor(GROVE_YEAR_MS / 24)
		const state = computeTreeState({
			speciesId,
			plantedAt,
			firstTree: false,
			lastCareAt: at,
			now: at
		})
		samples.push({
			month,
			season: state.season,
			blooming: state.blooming,
			fruiting: state.fruiting,
			autumnColor: state.autumnColor,
			leafFalling: state.leafFalling,
			bare: state.bare
		})
	}
	return samples
}
