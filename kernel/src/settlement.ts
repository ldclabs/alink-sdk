import type { SettlementCardStatus, SettlementMethodKind, SettlementSubjectKind } from './types.js'

// ---------------------------------------------------------------------------
// Settlement cards (docs/alink-settlement.md). Pure domain: types, limits,
// state machines and the write-path guards. Storage/arbitration live in the
// owner UserDO (§6 单点仲裁); nothing here may reach the network or a clock.
//
// The two invariants this module exists to make unbreakable (PRD §12.12):
//
//   INV-2 钱恒在放行之后 — no amount ever reaches the gatekeeper. The amount is
//   validated ONCE here at write time (§12.3) and thereafter only a display
//   snapshot survives; nothing in this file is importable by the policy engine
//   and no field below is shaped for aggregation.
//
//   INV-3 alink 恒不碰钱 — a card is a POINTER, never a channel. There is no
//   provider, no charge id, no payout, no fee: those fields do not exist, and
//   their absence is the design. Anything that would put alink between the two
//   parties belongs to a different document (§16.3 换收款主体).

/** Hard schema-level walls. Operator overrides ride `flags:settlement` KV. */
export const SETTLEMENT_LIMITS = {
	/** Configured payment methods per owner (§3.1). */
	maxMethods: 5,
	/** Outstanding (issued, unmarked) cards per connection (§3.2): exactly one,
	 * so「这次约谈对应哪张卡」is never ambiguous and card spam has no shape. */
	maxOutstandingPerConnection: 1,
	/** Card TTL (§3.2). */
	cardTtlMs: 30 * 86_400_000,
	/** Global amount ceiling in minor units (§12.3), default equivalent of
	 * US$500. A ceiling rather than a hope: §16.2 says the residual-risk story
	 * only holds while exposure is small, so it is enforced, not expected.
	 *
	 * ⚠️ Operator-tunable but NEVER per-plan (§9). Selling a higher ceiling
	 * would price risk exposure itself, and would void the §12.3 argument the
	 * moment it shipped. */
	defaultMaxAmountMinor: 50_000,
	/** Label/note/amount-text lengths — display snapshots, not parsed later. */
	maxLabelLength: 40,
	maxNoteLength: 200,
	maxValueLength: 2048
} as const

/** Currencies a card amount may be entered in. Display + ceiling comparison
 * only: nothing sums these, and no FX ever happens (INV-3). */
export const SETTLEMENT_CURRENCIES = ['usd', 'eur', 'gbp', 'hkd', 'cny', 'jpy'] as const
export type SettlementCurrency = (typeof SETTLEMENT_CURRENCIES)[number]

/**
 * Kinds the WRITE PATH accepts today (§4, DP-S4). `link` and `image` (收款码,
 * S-b); `crypto` stays refused until the four §4.3 preconditions are met.
 *
 * Crypto is not deferred for difficulty or for the buyer's onboarding cost —
 * it is deferred because it is the only payment rail with NO dispute mechanism
 * at all, which is precisely what §12.2 leans the whole no-escrow argument on.
 * Card networks charge back, PayPal and Alipay/WeChat arbitrate; a chain does
 * nothing. Opening it would silently void §12 for those transactions.
 */
export const SETTLEMENT_ENABLED_KINDS: readonly SettlementMethodKind[] = ['link', 'image']

export function isEnabledSettlementKind(kind: SettlementMethodKind): boolean {
	return SETTLEMENT_ENABLED_KINDS.includes(kind)
}

/**
 * One payment entry the owner configured (§3.1). `value` holds a URL for
 * `link`, a media key for `image`, an address for `crypto` — alink never
 * dereferences, probes or decodes any of them (§4.2/§4.4③).
 */
export interface SettlementMethod {
	id: string
	/** The owner's own words («我的 Stripe 收款链接»), shown to the payer. */
	label: string
	kind: SettlementMethodKind
	value: string
	/** Required and non-empty when kind === 'crypto' (§4.3); a bare address
	 * with no chain is how people lose money. */
	chain?: string
	/**
	 * Only meaningful for `image`: the owner declared this is a merchant /
	 * business collection code rather than a personal static one (§4.4②).
	 * Recorded because alink cannot verify it — the declaration is the artifact.
	 */
	merchantAttested: boolean
	active: boolean
	createdAt: number
	updatedAt: number
}

/**
 * A card issued into one connection's thread (§3.2).
 *
 * ⚠️ SNAPSHOT SEMANTICS — the single most load-bearing rule in this file.
 * `methodLabel`/`methodKind`/`methodValue` are COPIES taken at issue time, not
 * a `methodId` to resolve later. A card must render identically forever even
 * if the owner edits or deletes the method afterwards, because the alternative
 * is the account-takeover path: change one method, and every card ever sent
 * silently starts pointing at the attacker. Re-pointing a card is only ever
 * revoke + issue, and both are visible events in the thread.
 */
export interface SettlementCard {
	id: string
	connectionId: string
	/** What this card is for. `booking` or `none` — see SettlementSubjectKind:
	 * works/locker are pinned out of the enum as the App Store guard (§10). */
	subjectKind: SettlementSubjectKind
	/** Present only when subjectKind === 'booking'. */
	bookingId?: string
	methodLabel: string
	methodKind: SettlementMethodKind
	methodValue: string
	methodChain?: string
	/** Display snapshot: «US$120.00». Already ceiling-checked at write time and
	 * never re-parsed. Absent when the owner left the amount blank. */
	amountText?: string
	note?: string
	status: SettlementCardStatus
	/** The two sides' marks live apart on purpose (§3.4, DP-S5): when they
	 * disagree the UI shows both facts and alink decides nothing. */
	ownerMarked: boolean
	requesterMarked: boolean
	ownerMarkedAt?: number
	requesterMarkedAt?: number
	expiresAt: number
	createdAt: number
	updatedAt: number
}

/**
 * The structured payload of a thread 'system' message (§3.2 结算卡即共享事实),
 * mirroring BookingSystemEvent: CDEK-encrypted like every message, readable by
 * both sides, rendered by each client in its own locale.
 *
 * Carries no amount for the `revoked`/`marked` kinds — the card row already
 * holds it, and a system message is replayed in far more places.
 */
export interface SettlementSystemEvent {
	kind: 'settlement_card' | 'settlement_revoked' | 'settlement_marked'
	cardId: string
	/** Who marked (marked events only). */
	by?: 'owner' | 'requester'
	/** Issue events only — everything the card renders from. */
	methodLabel?: string
	methodKind?: SettlementMethodKind
	amountText?: string
	note?: string
}

export function parseSettlementSystemEvent(raw: string): SettlementSystemEvent | null {
	try {
		const parsed = JSON.parse(raw) as SettlementSystemEvent
		if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') return parsed
		return null
	} catch {
		return null
	}
}

const CARD_TRANSITIONS: Record<SettlementCardStatus, readonly SettlementCardStatus[]> = {
	// `marked_paid` is deliberately NOT terminal for the other side's mark: the
	// second mark updates its own boolean without a further transition, so a
	// one-sided card and a two-sided one share a status. The pair of booleans
	// is the fact; the status is only the ledger state.
	issued: ['marked_paid', 'revoked', 'expired'],
	marked_paid: [],
	revoked: [],
	expired: []
}

export function canTransitionSettlementCard(
	from: SettlementCardStatus,
	to: SettlementCardStatus
): boolean {
	return CARD_TRANSITIONS[from]?.includes(to) ?? false
}

/** A card still occupying its connection's single outstanding slot (§3.2). */
export function isCardOutstanding(card: SettlementCard, now: number): boolean {
	return card.status === 'issued' && card.expiresAt > now
}

export type SettlementValidationError =
	| 'SETTLEMENT_KIND_DISABLED'
	| 'SETTLEMENT_CHAIN_REQUIRED'
	| 'SETTLEMENT_VALUE_INVALID'
	| 'SETTLEMENT_LABEL_INVALID'
	| 'SETTLEMENT_AMOUNT_INVALID'
	| 'SETTLEMENT_AMOUNT_TOO_LARGE'
	| 'SETTLEMENT_SUBJECT_INVALID'
	| 'SETTLEMENT_MERCHANT_ATTESTATION_REQUIRED'

/**
 * Validate one payment method at the write path. Returns the error code rather
 * than throwing so the DO layer can map it (AlinkCoreError.from 纪律).
 *
 * A disabled kind is REFUSED, never silently dropped: a card that quietly did
 * not carry the method the owner chose is worse than an error.
 */
export function validateSettlementMethod(input: {
	label: string
	kind: SettlementMethodKind
	value: string
	chain?: string
	/** Owner's own declaration that an image is a MERCHANT code (§4.4②). */
	merchantAttested?: boolean
}): SettlementValidationError | null {
	if (!isEnabledSettlementKind(input.kind)) return 'SETTLEMENT_KIND_DISABLED'
	const label = input.label?.trim() ?? ''
	if (label.length === 0 || label.length > SETTLEMENT_LIMITS.maxLabelLength) {
		return 'SETTLEMENT_LABEL_INVALID'
	}
	const value = input.value?.trim() ?? ''
	if (value.length === 0 || value.length > SETTLEMENT_LIMITS.maxValueLength) {
		return 'SETTLEMENT_VALUE_INVALID'
	}
	if (input.kind === 'crypto' && !(input.chain?.trim() ?? '')) {
		return 'SETTLEMENT_CHAIN_REQUIRED'
	}
	if (input.kind === 'link' && !isSettlementUrl(value)) return 'SETTLEMENT_VALUE_INVALID'
	// A QR carries a media key, never a URL: the bytes are ours, the destination
	// inside them is not something we ever look at (§4.4③).
	if (input.kind === 'image' && !value.startsWith('settlement/')) {
		return 'SETTLEMENT_VALUE_INVALID'
	}
	// 商户码承诺 (§4.4②). 央行 259 号文 forbids a personal static code for remote,
	// non-face-to-face collection — which is exactly what a settlement card is —
	// and requires a merchant code for anyone with business activity. alink
	// cannot verify which kind an image is (it does not decode it), so what it
	// can do is make the owner say it, on the record. This is the same shape as
	// every other 「你自负这项合规」 in the terms, not a check we are pretending
	// to perform.
	if (input.kind === 'image' && !input.merchantAttested) {
		return 'SETTLEMENT_MERCHANT_ATTESTATION_REQUIRED'
	}
	return null
}

/**
 * https only — same rule as the card's own links (domain/forms.ts precedent).
 * Deliberately NO reachability probe: fetching whatever a user typed turns the
 * worker into an SSRF instrument, and it would also edge alink toward vouching
 * for where the link goes, which INV-3 says it must not do.
 */
export function isSettlementUrl(value: string): boolean {
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch {
		return false
	}
	return parsed.protocol === 'https:'
}

/**
 * Validate the amount at the ONLY moment it is ever read as a number (§12.3).
 * Callers persist the returned display text and drop the numeric value; no
 * later code path — reporting, analytics, the gatekeeper — may see it again.
 *
 * `maxAmountMinor` comes from the operator flag, global for everyone. Passing
 * a per-plan ceiling here is the mistake §9 warns about.
 */
export function validateSettlementAmount(
	amountMinor: number,
	currency: string,
	maxAmountMinor: number
): SettlementValidationError | null {
	if (!Number.isInteger(amountMinor) || amountMinor <= 0) return 'SETTLEMENT_AMOUNT_INVALID'
	if (!(SETTLEMENT_CURRENCIES as readonly string[]).includes(currency)) {
		return 'SETTLEMENT_AMOUNT_INVALID'
	}
	// Refused outright, never clamped: a card showing less than the owner typed
	// would be a silent misquote to the payer.
	if (amountMinor > maxAmountMinor) return 'SETTLEMENT_AMOUNT_TOO_LARGE'
	return null
}

/** Zero-decimal currencies (no minor unit) — JPY is the one in our list. */
const ZERO_DECIMAL: readonly string[] = ['jpy']

/** Render the display snapshot the card keeps forever (§3.2). */
export function formatSettlementAmount(amountMinor: number, currency: SettlementCurrency): string {
	const code = currency.toUpperCase()
	if (ZERO_DECIMAL.includes(currency)) return `${code} ${amountMinor}`
	const major = Math.floor(amountMinor / 100)
	const minor = String(amountMinor % 100).padStart(2, '0')
	return `${code} ${major}.${minor}`
}

/**
 * Guard for what a card may attach to (§10). Kept as a function so the App
 * Store constraint has one enforcement point that tests can pin, rather than
 * living implicitly in whatever the route happens to accept.
 */
export function isAllowedSettlementSubject(kind: string): kind is SettlementSubjectKind {
	return kind === 'booking' || kind === 'none'
}
