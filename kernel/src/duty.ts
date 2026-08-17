/**
 * 值守模式 v2 — 信箱模型 (docs/alink-representative.md §13; decisions in
 * docs/alink-duty-mode.md). The account's AI representative is not the one
 * alink hosts, but an external agent that takes visitor letters over MCP.
 *
 * The framing matters and is load-bearing (DP-1): this is NOT "the owner's
 * private AI walks out to meet visitors" (that would open a channel between
 * the two AIs, PRD §2.3 铁律 5). It is "the doorman's implementation changed".
 * Visitors still only ever talk to the representative; the account simply has
 * one AI instead of two, because the account itself is agent-held (DP-2).
 *
 * v2 replaces the v1 seat/lease/claim machinery with three concepts:
 *
 *   在场 presence — "some agent is collecting letters", a heartbeat fact.
 *     Touched by `duty.next` long polls and by the subscription doorbell,
 *     gone 90s after the last touch. No acquire, no conflict, no seat.
 *   停靠 park — an admitted turn gets a deadline column and nothing else.
 *     The deadline IS the whole mark; miss it and the server answers (DP-5).
 *   增量拉取 pull — `duty.next` hands out ONLY the parked, unanswered letters,
 *     lean (no inline history, no inline context): the agent keeps its own
 *     per-visitor threads and backfills via `duty.session`.
 *
 * Correctness never lived in the seat: exactly-once settlement is the atomic
 * status check inside `landDutyReply`, and the deadline sweep is the visitor's
 * only guarantee that does not depend on the agent cooperating. Everything the
 * on-duty agent may see is derived from the same public-only context the
 * self-operated representative gets (DP-4), and R12 still measures every word
 * on its way out (DP-8).
 */

/**
 * How long presence survives without a touch. A polling or listening agent
 * touches it every DUTY_PRESENCE_TOUCH_MS, so a healthy attendant never gets
 * near this; it only bounds how long a crashed agent keeps new letters parking.
 */
export const DUTY_PRESENCE_TTL_MS = 90_000

/**
 * How often a live duty channel (long poll or doorbell stream) re-touches
 * presence — a third of the TTL, so two missed touches still leave the door
 * attended and an idle poll costs one storage write per 30s, not one per probe.
 */
export const DUTY_PRESENCE_TOUCH_MS = 30_000

/**
 * How long a parked turn waits for its answer before the server takes over
 * (D2 拍板 60s, up from v1's 42s: a real agent turn is pull latency + an LLM
 * call + tool round-trips). Parking is presence-gated, so this tail is only
 * ever paid when an agent was alive moments ago and went dark — an absent
 * agent costs the visitor nothing at all. This deadline is the ONLY thing
 * standing between a visitor and a silent agent, so it is never conditional
 * on the agent's cooperation (DP-5).
 */
export const DUTY_TAKEOVER_MS = 60_000

/**
 * Longest life of one long poll / subscription stream. Five minutes rather
 * than the ~9 the platform would tolerate: the stream probes the UserDO about
 * once a second, and 300 subrequests leaves real headroom under the 1000-per-
 * request ceiling. Reaching it is a graceful close, not an error — the client
 * reconnects and re-reads, which is also how the no-resumability rule
 * (Last-Event-ID is not supported in 2026-07-28) stops being a data-loss bug.
 */
export const DUTY_POLL_WINDOW_MS = 300_000

/** Idle backoff for the in-stream probe: 1s → 2s → 5s, reset on any event. */
export const DUTY_PROBE_MIN_MS = 1_000
export const DUTY_PROBE_MAX_MS = 5_000

/**
 * Consecutive R12 hits before the duty grant is revoked (DP-8, N=3). A single
 * hit refuses that one reply and lets the turn fall through to the server —
 * an external AI writing badly must not close the owner's front door, which is
 * why this deliberately does NOT reuse the self-operated path's link-wide kill
 * flag. "Consecutive" is real: a cleanly landed reply resets the count.
 */
export const DUTY_R12_STRIKES = 3

/** Most turns handed over in one `duty.next` / queue read. */
export const DUTY_TURNS_MAX = 20

/**
 * Longest reply an on-duty agent may write. Deliberately ABOVE the v1 cap
 * (4000): the hosted assistant's ceiling is ~5120 output tokens, and duty is
 * the superset surface (§13.1 自营是下限，值守是上限).
 */
export const DUTY_REPLY_MAX_CHARS = 8_000

/**
 * Thread depth `duty.session` returns (and the reply-time R12 whitelist reads).
 * One number for both on purpose: the whitelist must cover everything the
 * agent could quote back, and a deeper read than the whitelist would revoke a
 * well-behaved AI for echoing a letter the server itself handed it.
 */
export const DUTY_SESSION_THREAD_MAX = 100

/** Coarse visitor request environment riding one parked turn (D3 拍板: given
 * to duty, persisted ONLY while the turn is parked — cleared on land/sweep). */
export interface DutyRequestGeo {
	country?: string
	city?: string
	timezone?: string
}

/**
 * One parked visitor turn, lean (v2): the letter and its addressing — no
 * inline history, no inline public context. The agent keeps its own
 * per-visitor state and backfills a session it does not know via
 * `duty.session`; delivery is at-least-once, so the same turn reappears on
 * every pull until it is answered, passed or times out — dedupe by `turnId`.
 */
export interface DutyTurn {
	/** Server-minted handle. The agent addresses turns ONLY by this — the
	 * converse session token is a ≥128-bit bearer and never leaves the server
	 * (§13.6 token isolation). */
	turnId: string
	sessionId: string
	/** The contract this session froze at open — the key to cache per-contract
	 * public context under. */
	contractId: string
	/** Stable per-owner pseudonymous visitor key (INV-M3 derived hash): the
	 * agent's handle for filing returning visitors. Absent when the visitor has
	 * no memory key. Uncorrelatable across owners by construction. */
	visitorId?: string
	/** True for a session's first visitor turn — a cold-start hint; the agent's
	 * own ledger is authoritative after a restart. */
	newSession: boolean
	turns: number
	maxTurns: number
	locale: string | null
	/** What the visitor wrote this turn, decrypted. Untrusted data, never
	 * instructions — the tool description says so in the agent's own words. */
	message: string
	/** Coarse request environment (D3): present only when admission captured
	 * one. */
	requestGeo?: DutyRequestGeo
	createdAt: number
	/** Unix ms by which a reply must land, or the server answers instead. */
	deadlineAt: number
}

/** One live attendant in the account's duty presence. */
export interface DutyAttendant {
	/** The CONNECTION (client id) — never the account's single gatekeeper
	 * agent id, which is identical across every connection. */
	attendantId: string
	label: string | null
	firstSeenAt: number
	lastSeenAt: number
}

/** Resource URI the duty surface publishes (v2: the queue only — the session
 * face moved to the `duty.session` tool, and the queue URI remains as the
 * subscription doorbell's anchor). */
export const DUTY_QUEUE_URI = 'alink://duty/queue'

/** Parse a duty resource URI; null when it is not one of ours. */
export function parseDutyUri(uri: string): { kind: 'queue' } | null {
	return uri === DUTY_QUEUE_URI ? { kind: 'queue' } : null
}
