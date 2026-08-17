import { wallTimeToUtc, type Slot } from './scheduling.js'

// ---------------------------------------------------------------------------
// Busy-overlay ICS parsing (booking doc §6 ②, DP-B3-2). Pure domain: the
// UserDO fetches the owner's private ICS URL and hands the raw text here; this
// module extracts ONLY busy intervals inside the asked window. Event titles,
// descriptions and attendees are read and immediately dropped — they never
// appear in the return value, so nothing above this seam can persist them
// (§5 忙闲状态叠加泄露隐私: 即读即弃 by construction).

/** Hard walls for the fetch/parse path (§5 缓解: bounded input, bounded output). */
export const BUSY_LIMITS = {
	/** Refuse ICS payloads beyond this many bytes (UTF-8). */
	maxFetchBytes: 2 * 1024 * 1024,
	/** Merged busy intervals kept per refresh; beyond this the tail is dropped. */
	maxIntervals: 1000,
	/** Recurrence expansions considered per VEVENT before giving up. */
	maxOccurrencesPerEvent: 500,
	/** VEVENT blocks examined per calendar. */
	maxEvents: 5000
} as const

export interface BusyParseResult {
	/** Merged, sorted busy intervals clipped to the requested window. */
	intervals: Slot[]
	/** True when an input bound was hit (events or intervals dropped). */
	truncated: boolean
}

export interface BusyParseOptions {
	/** Clip window (UTC ms): occurrences outside are discarded. */
	windowStart: number
	windowEnd: number
	/** Zone for VALUE=DATE (all-day) and floating times — the owner's
	 * scheduling timezone, the only zone the overlay is judged in. */
	defaultTimeZone: string
}

/** Unfold RFC 5545 §3.1 content lines (CRLF/LF + leading space or tab). */
function unfoldLines(text: string): string[] {
	const raw = text.split(/\r\n|\n|\r/)
	const out: string[] = []
	for (const line of raw) {
		if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
			out[out.length - 1] += line.slice(1)
		} else if (line.length > 0) {
			out.push(line)
		}
	}
	return out
}

interface IcsProp {
	name: string
	params: Map<string, string>
	value: string
}

function parseProp(line: string): IcsProp | null {
	const colon = line.indexOf(':')
	if (colon <= 0) return null
	const head = line.slice(0, colon)
	const value = line.slice(colon + 1)
	const parts = head.split(';')
	const name = parts[0].toUpperCase()
	const params = new Map<string, string>()
	for (const part of parts.slice(1)) {
		const eq = part.indexOf('=')
		if (eq > 0) params.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1))
	}
	return { name, params, value }
}

/** A wall-clock anchor for non-UTC values: RFC 5545 recurrences specified
 * with TZID (or floating / all-day) keep their LOCAL time across DST, so the
 * expansion must step in this zone's calendar and resolve each beat through
 * the tz engine. `wall === null` means a trailing-Z value — fixed UTC, which
 * deliberately does NOT shift with DST. */
interface IcsTime {
	ms: number
	/** VALUE=DATE input (all-day semantics). */
	dateOnly: boolean
	wall: {
		tz: string
		year: number
		month: number
		day: number
		minuteOfDay: number
		second: number
	} | null
}

const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/

/**
 * Resolve a DATE / DATE-TIME property value to UTC ms plus its wall anchor.
 * TZID (stripped of any leading '/') resolves through the Intl engine;
 * unknown zones make the whole event unusable (better to drop than to guess
 * a wrong wall clock). Floating times and all-day dates anchor to
 * `defaultTimeZone`.
 */
function parseIcsTime(prop: IcsProp, defaultTimeZone: string): IcsTime | null {
	const value = prop.value.trim()
	const dateMatch = DATE_ONLY.exec(value)
	if (dateMatch) {
		const [, y, mo, d] = dateMatch
		const wall = {
			tz: defaultTimeZone,
			year: Number(y),
			month: Number(mo),
			day: Number(d),
			minuteOfDay: 0,
			second: 0
		}
		const ms = resolveWall(wall)
		return ms === null ? null : { ms, dateOnly: true, wall }
	}
	if (prop.params.get('VALUE') === 'DATE') return null // malformed DATE value
	const dt = DATE_TIME.exec(value)
	if (!dt) return null
	const [, y, mo, d, h, mi, s, z] = dt
	if (z === 'Z') {
		return {
			ms: Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
			dateOnly: false,
			wall: null
		}
	}
	const wall = {
		tz: prop.params.get('TZID')?.replace(/^\//, '') ?? defaultTimeZone,
		year: Number(y),
		month: Number(mo),
		day: Number(d),
		minuteOfDay: Number(h) * 60 + Number(mi),
		second: Number(s)
	}
	const ms = resolveWall(wall)
	return ms === null ? null : { ms, dateOnly: false, wall }
}

/** Wall anchor → UTC ms via the locked DST rules; null on a skipped wall
 * time or an unknown zone. */
function resolveWall(wall: NonNullable<IcsTime['wall']>): number | null {
	try {
		const ms = wallTimeToUtc(wall.tz, wall.year, wall.month, wall.day, wall.minuteOfDay)
		return ms === null ? null : ms + wall.second * 1000
	} catch {
		return null
	}
}

/** ISO-8601 durations as RFC 5545 uses them (P1D, PT30M, P1DT2H, -PT15M…). */
function parseIcsDuration(value: string): number | null {
	const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
		value.trim()
	)
	if (!m) return null
	const sign = m[1] === '-' ? -1 : 1
	const [weeks, days, hours, minutes, seconds] = [m[2], m[3], m[4], m[5], m[6]].map((v) =>
		v ? Number(v) : 0
	)
	return (
		sign *
		(weeks * 7 * 86_400_000 +
			days * 86_400_000 +
			hours * 3_600_000 +
			minutes * 60_000 +
			seconds * 1000)
	)
}

const WEEKDAY_CODES: Record<string, number> = {
	SU: 0,
	MO: 1,
	TU: 2,
	WE: 3,
	TH: 4,
	FR: 5,
	SA: 6
}

interface Rrule {
	freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
	interval: number
	count: number | null
	untilMs: number | null
	/** WEEKLY only: BYDAY weekday numbers (0=SU..6=SA). */
	byday: number[]
}

/**
 * Parse the RRULE forms Google/Apple/Outlook busy exports actually emit:
 * FREQ DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL / COUNT / UNTIL, plus
 * weekly BYDAY lists. Modifiers we cannot honor faithfully (BYSETPOS,
 * BYMONTHDAY lists, monthly BYDAY ordinals…) return null and the event
 * contributes only its master occurrence — under-blocking a rare exotic
 * series beats mis-placing its occurrences.
 */
function parseRrule(value: string, defaultTimeZone: string): Rrule | null {
	const parts = new Map<string, string>()
	for (const kv of value.split(';')) {
		const eq = kv.indexOf('=')
		if (eq > 0) parts.set(kv.slice(0, eq).toUpperCase(), kv.slice(eq + 1))
	}
	const freq = parts.get('FREQ')?.toUpperCase()
	if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null
	const unsupported = ['BYSETPOS', 'BYMONTHDAY', 'BYYEARDAY', 'BYWEEKNO', 'BYMONTH', 'BYHOUR']
	if (unsupported.some((k) => parts.has(k))) return null
	let byday: number[] = []
	const bydayRaw = parts.get('BYDAY')
	if (bydayRaw) {
		// Ordinal BYDAY (e.g. 2TU "second Tuesday") only expands correctly for
		// monthly rules we do not model — bail to the master occurrence.
		if (freq !== 'WEEKLY') return null
		for (const code of bydayRaw.split(',')) {
			const day = WEEKDAY_CODES[code.trim().toUpperCase()]
			if (day === undefined) return null
			byday.push(day)
		}
	}
	const interval = Math.max(1, Number(parts.get('INTERVAL') ?? '1') || 1)
	const countRaw = parts.get('COUNT')
	const count = countRaw ? Math.max(1, Number(countRaw) || 1) : null
	let untilMs: number | null = null
	const until = parts.get('UNTIL')
	if (until) {
		const parsed = parseIcsTime({ name: 'UNTIL', params: new Map(), value: until }, defaultTimeZone)
		if (!parsed) return null
		// An all-day UNTIL bounds inclusively through that local day.
		untilMs = parsed.dateOnly ? parsed.ms + 86_400_000 - 1 : parsed.ms
	}
	return { freq, interval, count, untilMs, byday }
}

interface ParsedEvent {
	uid: string | null
	start: IcsTime
	durationMs: number
	rrule: Rrule | null
	exdates: Set<number>
	/** RECURRENCE-ID: this VEVENT overrides that occurrence of its UID. */
	recurrenceId: number | null
	transparent: boolean
	cancelled: boolean
}

/** CPU wall for one event's beat walk: enough for a ~500-year daily series
 * to reach any realistic window, cheap enough for the DO's single thread. */
const MAX_EXPANSION_ITERATIONS = 200_000

interface LocalDay {
	year: number
	month: number
	day: number
}

function addDaysLocal(d: LocalDay, days: number): LocalDay {
	const t = new Date(Date.UTC(d.year, d.month - 1, d.day) + days * 86_400_000)
	return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The beat `dayOffset` days after DTSTART, at DTSTART's WALL time: TZID/
 * floating/all-day series keep their local clock across DST (resolved per
 * beat), trailing-Z series step in fixed UTC. null = unrealizable beat
 * (spring-forward gap / unknown zone). */
function dayBeat(event: ParsedEvent, dayOffset: number): number | null {
	const wall = event.start.wall
	if (!wall) return event.start.ms + dayOffset * 86_400_000
	const d = addDaysLocal(wall, dayOffset)
	return resolveWall({ ...wall, year: d.year, month: d.month, day: d.day })
}

/** The beat `months` months after DTSTART — exact-day matches only (a Jan-31
 * monthly series contributes Jan 31, Mar 31, … and skips Feb, mirroring
 * mainstream clients); skipped beats consume no COUNT (RFC semantics). */
function monthBeat(event: ParsedEvent, months: number): number | null {
	const wall = event.start.wall
	if (!wall) {
		const d = new Date(event.start.ms)
		const stepped = new Date(event.start.ms)
		stepped.setUTCMonth(d.getUTCMonth() + months)
		return stepped.getUTCDate() === d.getUTCDate() ? stepped.getTime() : null
	}
	const monthIndex = wall.month - 1 + months
	const year = wall.year + Math.floor(monthIndex / 12)
	const month = (((monthIndex % 12) + 12) % 12) + 1
	if (wall.day > daysInMonth(year, month)) return null
	return resolveWall({ ...wall, year, month })
}

/**
 * Expand one event's occurrence start times inside [windowStart, windowEnd),
 * in CHRONOLOGICAL order (weekly BYDAY iterates by offset-from-DTSTART, not
 * weekday code — an UNTIL/window stop must never drop an earlier-in-time
 * occurrence). COUNT is consumed by realized occurrences only, including the
 * pre-window ones (so an old series stays anchored correctly), never by
 * clamped-away or DST-skipped beats.
 */
function expandOccurrences(event: ParsedEvent, options: BusyParseOptions): number[] {
	const { rrule } = event
	if (!rrule) return [event.start.ms]
	const out: number[] = []
	const startWeekday = new Date(event.start.ms).getUTCDay()
	// Chronological within-week day offsets for weekly BYDAY; a single [0]
	// beat per step for every other freq.
	const weeklyOffsets =
		rrule.freq === 'WEEKLY' && rrule.byday.length > 0
			? [...new Set(rrule.byday.map((day) => (day - startWeekday + 7) % 7))].sort((a, b) => a - b)
			: null
	let occurrences = 0
	let iterations = 0
	for (let step = 0; ; step++) {
		for (const offset of weeklyOffsets ?? [0]) {
			if (++iterations > MAX_EXPANSION_ITERATIONS) return out
			if (rrule.count !== null && occurrences >= rrule.count) return out
			let ms: number | null
			switch (rrule.freq) {
				case 'DAILY':
					ms = dayBeat(event, step * rrule.interval)
					break
				case 'WEEKLY':
					ms = dayBeat(event, step * rrule.interval * 7 + offset)
					break
				case 'MONTHLY':
					ms = monthBeat(event, step * rrule.interval)
					break
				case 'YEARLY':
					ms = monthBeat(event, step * rrule.interval * 12)
					break
			}
			if (ms === null) continue // clamped/skipped beat: no COUNT consumed
			if (rrule.untilMs !== null && ms > rrule.untilMs) return out
			if (ms >= options.windowEnd) return out // chronological ⇒ nothing later fits
			occurrences += 1
			if (ms + event.durationMs > options.windowStart) {
				out.push(ms)
				if (out.length >= BUSY_LIMITS.maxOccurrencesPerEvent) return out
			}
		}
	}
}

/** Merge overlapping/adjacent intervals (lossless for busy semantics). */
export function mergeBusyIntervals(intervals: Slot[]): Slot[] {
	const sorted = [...intervals].sort((a, b) => a.startAt - b.startAt)
	const out: Slot[] = []
	for (const interval of sorted) {
		const last = out[out.length - 1]
		if (last && interval.startAt <= last.endAt) {
			if (interval.endAt > last.endAt) last.endAt = interval.endAt
		} else {
			out.push({ ...interval })
		}
	}
	return out
}

/**
 * Extract busy intervals from an ICS calendar. Only DTSTART/DTEND/DURATION/
 * RRULE/EXDATE/RECURRENCE-ID/TRANSP/STATUS/UID are ever inspected; every other
 * property (SUMMARY, DESCRIPTION, ATTENDEE, …) is skipped unread — the return
 * value cannot carry event details by construction.
 */
export function parseBusyIcs(text: string, options: BusyParseOptions): BusyParseResult {
	const lines = unfoldLines(text)
	const events: ParsedEvent[] = []
	let truncated = false
	let current: {
		uid: string | null
		start: IcsTime | null
		end: IcsTime | null
		durationMs: number | null
		rrule: Rrule | null
		exdates: Set<number>
		recurrenceId: number | null
		transparent: boolean
		cancelled: boolean
	} | null = null
	for (const line of lines) {
		if (line === 'BEGIN:VEVENT') {
			if (events.length >= BUSY_LIMITS.maxEvents) {
				truncated = true
				break
			}
			current = {
				uid: null,
				start: null,
				end: null,
				durationMs: null,
				rrule: null,
				exdates: new Set(),
				recurrenceId: null,
				transparent: false,
				cancelled: false
			}
			continue
		}
		if (line === 'END:VEVENT') {
			if (current?.start) {
				let durationMs: number
				if (current.end) durationMs = current.end.ms - current.start.ms
				else if (current.durationMs !== null) durationMs = current.durationMs
				else durationMs = current.start.dateOnly ? 86_400_000 : 0
				if (durationMs > 0) {
					events.push({
						uid: current.uid,
						start: current.start,
						durationMs,
						rrule: current.rrule,
						exdates: current.exdates,
						recurrenceId: current.recurrenceId,
						transparent: current.transparent,
						cancelled: current.cancelled
					})
				}
			}
			current = null
			continue
		}
		if (!current) continue
		const prop = parseProp(line)
		if (!prop) continue
		switch (prop.name) {
			case 'UID':
				current.uid = prop.value
				break
			case 'DTSTART':
				current.start = parseIcsTime(prop, options.defaultTimeZone)
				break
			case 'DTEND':
				current.end = parseIcsTime(prop, options.defaultTimeZone)
				break
			case 'DURATION':
				current.durationMs = parseIcsDuration(prop.value)
				break
			case 'RRULE':
				current.rrule = parseRrule(prop.value, options.defaultTimeZone)
				break
			case 'EXDATE':
				for (const value of prop.value.split(',')) {
					const parsed = parseIcsTime({ ...prop, value }, options.defaultTimeZone)
					if (parsed) current.exdates.add(parsed.ms)
				}
				break
			case 'RECURRENCE-ID': {
				const parsed = parseIcsTime(prop, options.defaultTimeZone)
				current.recurrenceId = parsed?.ms ?? null
				break
			}
			case 'TRANSP':
				current.transparent = prop.value.trim().toUpperCase() === 'TRANSPARENT'
				break
			case 'STATUS':
				current.cancelled = prop.value.trim().toUpperCase() === 'CANCELLED'
				break
			default:
				// SUMMARY / DESCRIPTION / ATTENDEE / … — deliberately unread.
				break
		}
	}

	// A RECURRENCE-ID VEVENT replaces that occurrence of its master series:
	// suppress the master's beat at that instant (the override row stands on
	// its own — possibly moved, possibly cancelled).
	const overridden = new Map<string, Set<number>>()
	for (const event of events) {
		if (event.uid && event.recurrenceId !== null) {
			const set = overridden.get(event.uid) ?? new Set<number>()
			set.add(event.recurrenceId)
			overridden.set(event.uid, set)
		}
	}

	const intervals: Slot[] = []
	for (const event of events) {
		if (event.transparent || event.cancelled) continue
		const suppressed = event.uid ? overridden.get(event.uid) : undefined
		for (const startMs of expandOccurrences(event, options)) {
			if (event.exdates.has(startMs)) continue
			if (event.recurrenceId === null && suppressed?.has(startMs)) continue
			const startAt = Math.max(startMs, options.windowStart)
			const endAt = Math.min(startMs + event.durationMs, options.windowEnd)
			if (endAt > startAt) intervals.push({ startAt, endAt })
		}
	}
	const merged = mergeBusyIntervals(intervals)
	if (merged.length > BUSY_LIMITS.maxIntervals) {
		truncated = true
		merged.length = BUSY_LIMITS.maxIntervals
	}
	return { intervals: merged, truncated }
}
