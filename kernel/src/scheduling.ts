import type { SlotOfferStatus } from './types.js'

// ---------------------------------------------------------------------------
// Booking slots (docs/alink-booking-slots.md). Pure domain: types, limits and
// the timezone engine. Storage/arbitration live in the owner UserDO (§7 单点
// 仲裁); nothing here may reach the network or a clock.

/** Contract-level bounds (booking doc §3.1/§5). Operator overrides ride the
 * `flags:scheduling` KV blob, but these are the schema-level hard walls. */
export const SCHEDULING_LIMITS = {
	/** Slots per offer hand: 1–5 (§5 反推断 — never a full grid). */
	offerMaxSlots: 5,
	/** Re-deals per offer after「都不行」(§3.3): one, then human fallback. */
	redealLimit: 1,
	/** Outstanding (confirmed, future) bookings per requester (§5 防锁位). */
	maxOutstandingPerSender: 1,
	/** Booking-lifecycle emails per booking (DP-B3-1 受限修正案). */
	emailBudgetPerBooking: 3,
	/** Reminder yield ceiling (B3-b) = emailBudgetPerBooking − 2: a reminder
	 * only sends while emails_sent ≤ this, so the NON-DEGRADABLE owner-cancel
	 * notice always has a budget slot left (worst case confirmed + reminder +
	 * canceled = the full budget). Raise them together or the reminder starves. */
	reminderYieldMaxEmailsSent: 1,
	/** Requester self-reschedules per booking (§3.5 B3-b: 限 1 次, then the
	 * cancel + re-offer negotiation path remains the way out). */
	rescheduleLimit: 1,
	/** Offer TTL ceiling; effective TTL = min(this, earliest offered slot). */
	offerTtlMs: 7 * 86_400_000,
	horizonDaysMax: 60,
	minNoticeHoursMax: 14 * 24
} as const

/** Requester reminder mail leads the meeting by this much (DP-B3-1 reminder
 * class, B3-b). Budget-yielding: it only sends while emails_sent ≤ 1, so the
 * non-degradable cancel notice always has a slot left inside the ≤3 budget. */
export const BOOKING_REMINDER_LEAD_MS = 24 * 3_600_000

/** External busy-overlay refresh cadence (§6 ②): success → 6h, failure → 1h
 * retry with the stale intervals kept (missing data must fail toward "still
 * busy", never toward double-booking). */
export const BUSY_REFRESH_INTERVAL_MS = 6 * 3_600_000
export const BUSY_REFRESH_RETRY_MS = 3_600_000

export const SLOT_MINUTES_CHOICES = [15, 25, 30, 50, 60] as const
export type SlotMinutes = (typeof SLOT_MINUTES_CHOICES)[number]

export type MeetingLocationKind = 'video' | 'phone' | 'custom'

export interface MeetingLocation {
	kind: MeetingLocationKind
	/** Static text/link the owner configured (§3.1); shown only after confirm. */
	value: string
}

/**
 * Owner-side scheduling rule set (one row per UserDO). Pro+ gated via the
 * `autoArrange` entitlement; the whole feature pauses while past-due
 * (commercialization §5 欠费降级) and under the away overlay (C3).
 */
export interface SchedulingConfig {
	enabled: boolean
	/** IANA zone anchoring window expansion (§4); the single rule anchor. */
	timezone: string
	location: MeetingLocation
	/** Only offer slots within the next N days. */
	horizonDays: number
	/** Earliest offerable slot = now + this many hours. */
	minNoticeHours: number
	slotMinutes: SlotMinutes
	/** Idle gap enforced between alink bookings. */
	bufferMinutes: number
	/** Confirmed-booking budget hard tops (§5 第一道防线). */
	budgetPerDay: number
	budgetPerWeek: number
	/** Slots dealt per offer (1..offerMaxSlots). */
	offerSize: number
	/**
	 * Auto-offer (§3.4, DP-B3-3): config placeholder only in B3-a — the
	 * automatic path ships with B3-b. Server-side rejected (and UI greyed)
	 * whenever `meeting ∈ escalateAlways`; default off regardless.
	 */
	autoOfferEnabled: boolean
	updatedAt: number
}

export const DEFAULT_SCHEDULING_CONFIG: Omit<SchedulingConfig, 'timezone' | 'updatedAt'> = {
	enabled: false,
	location: { kind: 'video', value: '' },
	horizonDays: 14,
	minNoticeHours: 24,
	slotMinutes: 30,
	bufferMinutes: 15,
	budgetPerDay: 2,
	budgetPerWeek: 6,
	offerSize: 3,
	autoOfferEnabled: false
}

/** Which relationships may see a window (§3.1 关系分层): `approved` = anyone
 * the owner released; `trusted` = only trusted+ relationships get these
 * (deeper) windows offered. */
export type WindowAudience = 'approved' | 'trusted'

export interface AvailabilityWindow {
	id: string
	/** 0 = Sunday … 6 = Saturday, in the owner timezone. */
	weekday: number
	/** Minutes since local midnight, [0, 1440); end exclusive, end > start. */
	startMinute: number
	endMinute: number
	audience: WindowAudience
	active: boolean
}

export interface AvailabilityException {
	id: string
	/** Owner-timezone local day, 'YYYY-MM-DD'. */
	date: string
	kind: 'blocked' | 'extra_window'
	/** Present when kind = 'extra_window'; same minute semantics as windows. */
	startMinute?: number
	endMinute?: number
	audience: WindowAudience
}

/** A concrete offerable interval, always UTC unix ms (全库时间戳纪律). */
export interface Slot {
	startAt: number
	endAt: number
}

export interface SlotOffer {
	id: string
	connectionId: string
	intakeId: string
	slots: readonly Slot[]
	status: SlotOfferStatus
	/** How many re-deals produced this offer chain (0 on the first hand). */
	redealCount: number
	/** 'manual' now; 'auto_offer' arrives with B3-b (§3.4 判定表). */
	origin: 'manual' | 'auto_offer'
	expiresAt: number
	createdAt: number
	updatedAt: number
}

export type BookingStatus = 'confirmed' | 'canceled_owner' | 'canceled_requester' | 'done'

/**
 * The structured payload of a thread 'system' message (§3.3 预约事实即共享
 * 事实): CDEK-encrypted like every message, readable by both sides, rendered
 * by each client in its own locale/timezone.
 */
export interface BookingSystemEvent {
	kind: 'booking_confirmed' | 'booking_canceled' | 'booking_rescheduled'
	/** Who canceled/rescheduled (canceled + rescheduled events only). */
	by?: 'owner' | 'requester'
	startAt: number
	endAt: number
	/** Owner timezone at event time (dual-zone rendering, §4). */
	timezone: string
	location?: MeetingLocation
}

export function parseBookingSystemEvent(raw: string): BookingSystemEvent | null {
	try {
		const parsed = JSON.parse(raw) as BookingSystemEvent
		if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') return parsed
		return null
	} catch {
		return null
	}
}

/**
 * A booking fact: one slot the requester confirmed out of an offer. `done` is
 * flipped by the sweep alarm once endAt passes; `noShow` is an owner-side
 * marker bit on a done row, NOT a status (DP-B3-4: it feeds that single
 * relationship's memory and nothing else — never aggregated per person).
 */
export interface Booking {
	id: string
	offerId: string
	connectionId: string
	intakeId: string
	slot: Slot
	status: BookingStatus
	noShow: boolean
	location: MeetingLocation
	/** Owner timezone captured at confirm time (ICS + dual-zone rendering). */
	ownerTimezone: string
	emailsSent: number
	/** Requester self-reschedules consumed (≤ rescheduleLimit, B3-b §3.5). */
	rescheduleCount: number
	createdAt: number
	updatedAt: number
}

const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
	confirmed: ['canceled_owner', 'canceled_requester', 'done'],
	canceled_owner: [],
	canceled_requester: [],
	done: []
}

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
	return BOOKING_TRANSITIONS[from]?.includes(to) ?? false
}

const OFFER_TRANSITIONS: Record<SlotOfferStatus, readonly SlotOfferStatus[]> = {
	issued: ['consumed', 'expired', 'revoked', 'redealt'],
	consumed: [],
	expired: [],
	revoked: [],
	redealt: []
}

export function canTransitionOffer(from: SlotOfferStatus, to: SlotOfferStatus): boolean {
	return OFFER_TRANSITIONS[from]?.includes(to) ?? false
}

// ---------------------------------------------------------------------------
// Timezone engine (§4). Zero third-party tz libraries: the deliberate
// weekly-windows + date-exceptions shape keeps expansion a plain calculation
// over Intl.DateTimeFormat offsets.

export function isValidTimeZone(tz: string): boolean {
	if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false
	try {
		const zones = Intl.supportedValuesOf('timeZone')
		if (zones.includes(tz)) return true
	} catch {
		// fall through to the constructor probe
	}
	if (tz === 'UTC') return true
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz })
		return true
	} catch {
		return false
	}
}

const dtfCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
	let dtf = dtfCache.get(timeZone)
	if (!dtf) {
		dtf = new Intl.DateTimeFormat('en-US', {
			timeZone,
			calendar: 'iso8601',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		})
		dtfCache.set(timeZone, dtf)
	}
	return dtf
}

interface WallParts {
	year: number
	month: number
	day: number
	hour: number
	minute: number
	second: number
}

function wallPartsAt(timeZone: string, utcMs: number): WallParts {
	const parts = formatterFor(timeZone).formatToParts(new Date(utcMs))
	const out: Record<string, number> = {}
	for (const p of parts) {
		if (p.type !== 'literal') out[p.type] = Number(p.value)
	}
	return {
		year: out.year ?? 1970,
		month: out.month ?? 1,
		day: out.day ?? 1,
		// h23 may still surface hour 24 on some engines; normalize to 0.
		hour: (out.hour ?? 0) % 24,
		minute: out.minute ?? 0,
		second: out.second ?? 0
	}
}

/** (local wall − UTC) in ms at the given instant, second-truncated. */
export function utcOffsetMs(timeZone: string, utcMs: number): number {
	const w = wallPartsAt(timeZone, utcMs)
	const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
	return asUtc - Math.floor(utcMs / 1000) * 1000
}

/**
 * Map an owner-timezone wall time to a UTC instant under the locked DST rules
 * (§4, 测试锁定): spring-forward skipped wall times return null (dropped);
 * fall-back repeated wall times resolve to the FIRST occurrence (earlier UTC).
 */
export function wallTimeToUtc(
	timeZone: string,
	year: number,
	month: number,
	day: number,
	minuteOfDay: number
): number | null {
	const wallMs = Date.UTC(year, month - 1, day, 0, minuteOfDay)
	const candidates = new Set<number>()
	for (const probe of [wallMs - 86_400_000, wallMs, wallMs + 86_400_000]) {
		const offset = utcOffsetMs(timeZone, probe)
		const utc = wallMs - offset
		if (utcOffsetMs(timeZone, utc) === offset) candidates.add(utc)
	}
	if (candidates.size === 0) return null
	return Math.min(...candidates)
}

/** Owner-timezone local day key ('YYYY-MM-DD') for a UTC instant — the unit
 * of the per-day budget and of exception matching. */
export function localDayKey(timeZone: string, utcMs: number): string {
	const w = wallPartsAt(timeZone, utcMs)
	const mm = String(w.month).padStart(2, '0')
	const dd = String(w.day).padStart(2, '0')
	return `${w.year}-${mm}-${dd}`
}

/** Monday of the owner-timezone local week ('YYYY-MM-DD') — the per-week
 * budget bucket key. */
export function localWeekKey(timeZone: string, utcMs: number): string {
	const w = wallPartsAt(timeZone, utcMs)
	const dayUtc = Date.UTC(w.year, w.month - 1, w.day)
	const weekday = new Date(dayUtc).getUTCDay()
	const monday = new Date(dayUtc - ((weekday + 6) % 7) * 86_400_000)
	const mm = String(monday.getUTCMonth() + 1).padStart(2, '0')
	const dd = String(monday.getUTCDate()).padStart(2, '0')
	return `${monday.getUTCFullYear()}-${mm}-${dd}`
}

function weekdayOf(year: number, month: number, day: number): number {
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

interface LocalDate {
	year: number
	month: number
	day: number
}

function addDays(d: LocalDate, days: number): LocalDate {
	const t = new Date(Date.UTC(d.year, d.month - 1, d.day) + days * 86_400_000)
	return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

function dayKeyOf(d: LocalDate): string {
	return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

export interface ExpandOptions {
	/** Clock reference; slots starting before now + minNoticeHours are cut. */
	now: number
	/** Include `trusted`-audience windows (requester trust ≥ trusted, §3.1). */
	includeTrusted: boolean
}

/**
 * Materialize offerable slots over the config horizon: for each owner-local
 * day, resolve the weekday windows plus exceptions, convert wall minutes to
 * UTC per the DST rules, then slice into slotMinutes steps separated by
 * bufferMinutes. Purely计算 — busy/conflict/budget filtering is the caller's
 * (UserDO) concern against its own booking rows.
 */
export function expandSlots(
	config: Pick<
		SchedulingConfig,
		'timezone' | 'horizonDays' | 'minNoticeHours' | 'slotMinutes' | 'bufferMinutes'
	>,
	windows: readonly AvailabilityWindow[],
	exceptions: readonly AvailabilityException[],
	options: ExpandOptions
): Slot[] {
	const { timezone } = config
	const earliest = options.now + config.minNoticeHours * 3_600_000
	const horizonEnd = options.now + config.horizonDays * 86_400_000
	const byDate = new Map<string, AvailabilityException[]>()
	for (const ex of exceptions) {
		const list = byDate.get(ex.date) ?? []
		list.push(ex)
		byDate.set(ex.date, list)
	}
	const active = windows.filter(
		(w) => w.active && (options.includeTrusted || w.audience === 'approved')
	)
	const slots: Slot[] = []
	const step = config.slotMinutes + config.bufferMinutes
	// Start one local day early so a window straddling the now-boundary in a
	// west-of-UTC zone is not missed by the day walk.
	let cursor = (() => {
		const w = wallPartsAt(timezone, options.now)
		return addDays({ year: w.year, month: w.month, day: w.day }, -1)
	})()
	const horizonDayEnd = config.horizonDays + 2
	for (let i = 0; i < horizonDayEnd; i++, cursor = addDays(cursor, 1)) {
		const dayKey = dayKeyOf(cursor)
		const dayExceptions = byDate.get(dayKey) ?? []
		if (dayExceptions.some((ex) => ex.kind === 'blocked')) continue
		const weekday = weekdayOf(cursor.year, cursor.month, cursor.day)
		const ranges: Array<{ startMinute: number; endMinute: number }> = []
		for (const w of active) {
			if (w.weekday === weekday) ranges.push({ startMinute: w.startMinute, endMinute: w.endMinute })
		}
		for (const ex of dayExceptions) {
			if (
				ex.kind === 'extra_window' &&
				(options.includeTrusted || ex.audience === 'approved') &&
				typeof ex.startMinute === 'number' &&
				typeof ex.endMinute === 'number'
			) {
				ranges.push({ startMinute: ex.startMinute, endMinute: ex.endMinute })
			}
		}
		for (const range of ranges) {
			for (
				let minute = range.startMinute;
				minute + config.slotMinutes <= range.endMinute;
				minute += step
			) {
				const startAt = wallTimeToUtc(timezone, cursor.year, cursor.month, cursor.day, minute)
				if (startAt === null) continue // spring-forward skipped wall time
				if (startAt < earliest || startAt >= horizonEnd) continue
				slots.push({ startAt, endAt: startAt + config.slotMinutes * 60_000 })
			}
		}
	}
	slots.sort((a, b) => a.startAt - b.startAt)
	// Dedupe (an extra_window may overlap a weekly window).
	return slots.filter((s, i) => i === 0 || s.startAt !== slots[i - 1].startAt)
}

/**
 * Deal a hand of `count` slots from the candidates: spread across distinct
 * owner-local days first (earliest per day), then fill from the remainder —
 * the assistant's "打散挑选" that keeps the exposed data points scattered
 * (§5 反作息推断) while biasing early availability.
 */
export function pickOfferSlots(
	timeZone: string,
	candidates: readonly Slot[],
	count: number
): Slot[] {
	if (count <= 0) return []
	const byDay = new Map<string, Slot[]>()
	for (const slot of candidates) {
		const key = localDayKey(timeZone, slot.startAt)
		const list = byDay.get(key) ?? []
		list.push(slot)
		byDay.set(key, list)
	}
	const picked: Slot[] = []
	const days = [...byDay.keys()].sort()
	for (const day of days) {
		if (picked.length >= count) break
		const first = byDay.get(day)?.[0]
		if (first) picked.push(first)
	}
	if (picked.length < count) {
		const chosen = new Set(picked.map((s) => s.startAt))
		for (const slot of candidates) {
			if (picked.length >= count) break
			if (!chosen.has(slot.startAt)) {
				picked.push(slot)
				chosen.add(slot.startAt)
			}
		}
	}
	picked.sort((a, b) => a.startAt - b.startAt)
	return picked
}

/** Two intervals clash when they overlap after padding by the buffer. */
export function slotsClash(a: Slot, b: Slot, bufferMinutes: number): boolean {
	const pad = bufferMinutes * 60_000
	return a.startAt < b.endAt + pad && b.startAt < a.endAt + pad
}

/** Plain interval overlap — the busy-overlay test (§6 ②): external events
 * deliberately take no buffer padding (back-to-back with them is fine). One
 * overlap definition only: this is slotsClash with pad 0, so the boundary
 * semantics can never diverge between internal and external clashes. */
export function overlapsBusy(slot: Slot, busy: { start_at: number; end_at: number }): boolean {
	return slotsClash(slot, { startAt: busy.start_at, endAt: busy.end_at }, 0)
}

/** Human-readable meeting time in the owner zone (booking emails, §4 双时区
 * 并列 rides the thread views; mail states the owner zone explicitly). */
export function formatBookingWhen(locale: string, timeZone: string, startAt: number): string {
	try {
		const formatted = new Intl.DateTimeFormat(locale, {
			timeZone,
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
			timeZoneName: 'short'
		}).format(new Date(startAt))
		return `${formatted} (${timeZone})`
	} catch {
		return `${new Date(startAt).toISOString()} (UTC)`
	}
}

export interface SchedulingConfigIssue {
	field: string
	reason: string
}

/** Schema-level validation shared by the HTTP layer and the DO write path. */
export function validateSchedulingConfig(config: SchedulingConfig): SchedulingConfigIssue[] {
	const issues: SchedulingConfigIssue[] = []
	if (!isValidTimeZone(config.timezone)) issues.push({ field: 'timezone', reason: 'invalid' })
	if (!SLOT_MINUTES_CHOICES.includes(config.slotMinutes)) {
		issues.push({ field: 'slotMinutes', reason: 'invalid' })
	}
	if (
		!Number.isInteger(config.horizonDays) ||
		config.horizonDays < 1 ||
		config.horizonDays > SCHEDULING_LIMITS.horizonDaysMax
	) {
		issues.push({ field: 'horizonDays', reason: 'out_of_range' })
	}
	if (
		!Number.isInteger(config.minNoticeHours) ||
		config.minNoticeHours < 0 ||
		config.minNoticeHours > SCHEDULING_LIMITS.minNoticeHoursMax
	) {
		issues.push({ field: 'minNoticeHours', reason: 'out_of_range' })
	}
	if (
		!Number.isInteger(config.bufferMinutes) ||
		config.bufferMinutes < 0 ||
		config.bufferMinutes > 120
	) {
		issues.push({ field: 'bufferMinutes', reason: 'out_of_range' })
	}
	if (
		!Number.isInteger(config.budgetPerDay) ||
		config.budgetPerDay < 1 ||
		config.budgetPerDay > 12
	) {
		issues.push({ field: 'budgetPerDay', reason: 'out_of_range' })
	}
	if (
		!Number.isInteger(config.budgetPerWeek) ||
		config.budgetPerWeek < config.budgetPerDay ||
		config.budgetPerWeek > 60
	) {
		issues.push({ field: 'budgetPerWeek', reason: 'out_of_range' })
	}
	if (
		!Number.isInteger(config.offerSize) ||
		config.offerSize < 1 ||
		config.offerSize > SCHEDULING_LIMITS.offerMaxSlots
	) {
		issues.push({ field: 'offerSize', reason: 'out_of_range' })
	}
	if (
		config.location.kind !== 'video' &&
		config.location.kind !== 'phone' &&
		config.location.kind !== 'custom'
	) {
		issues.push({ field: 'location.kind', reason: 'invalid' })
	}
	if (typeof config.location.value !== 'string' || config.location.value.length > 500) {
		issues.push({ field: 'location.value', reason: 'too_long' })
	}
	return issues
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function validateAvailabilityWindow(w: {
	weekday: number
	startMinute: number
	endMinute: number
}): boolean {
	return (
		Number.isInteger(w.weekday) &&
		w.weekday >= 0 &&
		w.weekday <= 6 &&
		Number.isInteger(w.startMinute) &&
		Number.isInteger(w.endMinute) &&
		w.startMinute >= 0 &&
		w.endMinute <= 1440 &&
		w.endMinute > w.startMinute
	)
}

export function validateAvailabilityException(ex: {
	date: string
	kind: string
	startMinute?: number
	endMinute?: number
}): boolean {
	if (!DAY_KEY_PATTERN.test(ex.date)) return false
	if (ex.kind === 'blocked') return true
	if (ex.kind !== 'extra_window') return false
	return validateAvailabilityWindow({
		weekday: 0,
		startMinute: ex.startMinute ?? -1,
		endMinute: ex.endMinute ?? -1
	})
}
