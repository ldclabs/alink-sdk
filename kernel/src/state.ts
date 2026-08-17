import { AlinkCoreError } from './errors.js'
import type {
	AgentRequestStatus,
	ConnectionOrigin,
	ConnectionState,
	ConsentStatus,
	HandleStatus,
	IntakeOrigin,
	IntakeStatus,
	IntentKind,
	IntentVisibility,
	ReferralStatus,
	RelationshipState,
	SubscriptionStatus
} from './types.js'

/** Intent kinds (product doc §6.2); mirrors the IntentKind union for validators. */
export const INTENT_KINDS: readonly IntentKind[] = [
	'hiring',
	'job_seeking',
	'cofounder',
	'fundraising',
	'investing',
	'advising',
	'partnership',
	'speaking',
	'learning',
	'custom'
]

/** Active intents must expire (§6.2 活性设计); the service layer fills this in. */
export const INTENT_DEFAULT_TTL_MS = 90 * 86_400_000
/** Expiry reminders enter the digest this long before expiresAt (§5.2 AC). */
export const INTENT_REMINDER_LEAD_MS = 7 * 86_400_000
/** Visibility tiers a link URL exposes (§6.1: the URL is the link) — shared by
 * the principal document, the card payload and the guest-assistant context. */
export const LINK_VISIBLE_INTENT_TIERS = ['public', 'link_only'] as const

/**
 * §6.2 hard constraint ladder: intent visibility may never exceed the
 * profile's. Both the write-path assertion (services) and the read-path clamp
 * (UserDO.visibleIntents) rank against these — one ladder, two enforcement
 * points, because stored rows can outrank the card after a downgrade.
 */
export const INTENT_VISIBILITY_RANK: Record<IntentVisibility, number> = {
	private: 0,
	trusted_network: 1,
	link_only: 2,
	public: 3
}
/** Human-card tiers on the same ladder (cards have no trusted_network tier). */
export const CARD_VISIBILITY_RANK: Record<'private' | 'link_only' | 'public', number> = {
	private: 0,
	link_only: 2,
	public: 3
}

export const RELATIONSHIP_TRANSITIONS: Record<RelationshipState, readonly RelationshipState[]> = {
	draft: ['pending_counterparty'],
	pending_counterparty: ['active_weak', 'revoked'],
	active_weak: ['active_trusted', 'muted', 'revoked'],
	active_trusted: ['collaborator', 'muted', 'revoked'],
	collaborator: ['muted', 'revoked'],
	muted: ['active_weak', 'active_trusted', 'revoked'],
	revoked: []
}

export const AGENT_REQUEST_TRANSITIONS: Record<AgentRequestStatus, readonly AgentRequestStatus[]> =
	{
		draft: ['policy_checked', 'approval_required', 'closed'],
		policy_checked: ['approval_required', 'queued', 'closed'],
		approval_required: ['approved', 'rejected', 'closed'],
		approved: ['queued', 'closed'],
		rejected: ['closed'],
		queued: ['delivered', 'closed'],
		delivered: ['counterparty_review', 'accepted', 'declined', 'more_context_required'],
		counterparty_review: ['accepted', 'declined', 'more_context_required', 'closed'],
		more_context_required: ['queued', 'closed'],
		accepted: ['completed'],
		declined: ['closed'],
		completed: [],
		closed: []
	}

export const CONSENT_TRANSITIONS: Record<ConsentStatus, readonly ConsentStatus[]> = {
	active: ['expired', 'revoked', 'suspended'],
	suspended: ['active', 'revoked', 'expired'],
	expired: [],
	revoked: []
}

// Handle lifecycle (product doc §6.4, commercialization doc §10.2/§11.4).
// reserved/protected are administrative states outside the automatic renewal
// scans. active -> grace is the non-payment path; active -> cooldown is the
// direct path for swaps and account deletion (§3.1/§11.3). cooldown -> active
// is the previous owner's redemption path; the owner guard lives in the
// service layer, this table only declares topology.
export const HANDLE_TRANSITIONS: Record<HandleStatus, readonly HandleStatus[]> = {
	available: ['active', 'reserved', 'protected'],
	active: ['grace', 'cooldown'],
	grace: ['active', 'cooldown'],
	cooldown: ['active', 'available'],
	reserved: ['available', 'active'],
	protected: ['active', 'available']
}

// Subscription lifecycle (commercialization doc §10.2). Stripe is the source
// of truth; local transitions mirror its webhook event stream.
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
	trialing: ['active', 'expired'],
	active: ['past_due', 'canceled'],
	past_due: ['active', 'canceled'],
	canceled: ['expired'],
	expired: []
}

// Public request-intake lifecycle (product doc §5.2/§5.3). The sender only ever
// sees the coarse status; the internal triage band lives beside it. Terminal
// states are `closed` and `replied`/`declined` after the owner acts.
export const INTAKE_TRANSITIONS: Record<IntakeStatus, readonly IntakeStatus[]> = {
	received: ['needs_more_context', 'triaged', 'closed'],
	needs_more_context: ['triaged', 'received', 'closed'],
	triaged: ['approved', 'declined', 'needs_more_context', 'closed'],
	approved: ['replied', 'closed'],
	replied: ['closed'],
	// A declined intake can be reopened by the owner overturning a false positive.
	declined: ['triaged', 'closed'],
	closed: []
}

// Referral conversion lifecycle (credits doc §10.2). Attribution is immutable
// once locked at signup; the row only ever advances. `rejected` covers risk
// interception and a referee who canceled during the hold; `forfeited` means
// the referrer was no longer on an active paid plan at grant time. `rewarded`
// is terminal: a counted conversion is never clawed back — a post-hold
// chargeback only sets a risk flag (credits doc §3.5).
export const REFERRAL_TRANSITIONS: Record<ReferralStatus, readonly ReferralStatus[]> = {
	// Conversion eligibility is locked at attribution time (§3.1 防「先攒归因后
	// 补票」): a row born ineligible never enters the conversion lifecycle. It
	// still counts toward §3.7 network achievements and §8 attribution metrics.
	recorded: [],
	pending: ['qualified', 'rejected', 'expired'],
	qualified: ['rewarded', 'rejected', 'forfeited'],
	rewarded: [],
	rejected: [],
	expired: [],
	forfeited: []
}

// ---------------------------------------------------------------------------
// Connection.state projection (product doc §6.6). Deliberately NOT a third
// state machine: the protocol-layer statuses stay the single source of truth
// and these pure functions derive the product-layer Connection.state from
// them, so the two vocabularies can never drift apart (PRD 附录 B-2 closed).

/**
 * §9.1 ③ correction window: a receiver's misrelease flag only pulls the
 * connection back out of MCC within 7 days of its connected flip. The P1
 * requester-side regret action (「不再需要」) uses the same window by decision
 * (对称 7 日) and will reuse the same subtraction path.
 */
export const CONNECTED_CORRECTION_WINDOW_MS = 7 * 86_400_000

/**
 * The stored `reply_email_hash` of a request whose sender left NO mailbox
 * (evidence-plan E2 / DP-E2): asking costs no identity, and an address is only
 * needed to receive an answer — one way is an email, the other is claiming the
 * receipt with a passkey, which sends nothing anywhere.
 *
 * ⚠️ A sentinel rather than NULL because `request_intakes.reply_email_hash` is
 * `NOT NULL` on every live UserDO and SQLite cannot relax that without
 * rebuilding the table inside each owner's DO. `''` is not a possible
 * sha256Base64Url output, so it cannot collide with a real address.
 *
 * ⚠️⚠️ Every query that MATCHES on that column must exclude the sentinel, or
 * all mailbox-less senders collapse into one identity: the per-sender frequency
 * window (`countRecentFromSender`) and the booking history join
 * (`bookingHistoryForSender`) both carry `<> ''` for exactly that reason.
 * «A stranger refused for someone else's frequency» is what a missing guard
 * looks like from outside.
 */
export const NO_REPLY_EMAIL = ''

/** Whether this request carries a mailbox at all — the one predicate. */
export function hasReplyEmail(row: { reply_email_hash: string }): boolean {
	return row.reply_email_hash !== NO_REPLY_EMAIL
}

/**
 * Intake channel → Connection.state. `bothMessaged` is the §6.6 connected
 * test: after release, each side has posted ≥1 real thread message (the
 * intake body / seed opener and any auto receipt are excluded). It only ever
 * flips false→true (messages are never deleted), so the projection is stable.
 */
export function connectionStateForIntake(
	status: IntakeStatus,
	bothMessaged: boolean
): ConnectionState {
	switch (status) {
		case 'received':
			return 'proposed'
		case 'needs_more_context':
		case 'triaged':
			return 'screening'
		case 'approved':
		case 'replied':
			return bothMessaged ? 'connected' : 'approved'
		case 'declined':
			return 'declined'
		case 'closed':
			return 'closed'
	}
}

/**
 * Agent channel (13-state protocol machine, §11.1) → Connection.state.
 * Returns null while the request has not left the initiator's side — drafts,
 * pre-flight checks, the initiator's own approval gate and its rejection
 * never produce an Encounter, so no Connection exists for them (§6.6 公理:
 * 双向确认之前只有 Encounter；触达之前连 Encounter 都没有).
 */
export function connectionStateForAgentRequest(
	status: AgentRequestStatus,
	bothMessaged: boolean
): ConnectionState | null {
	switch (status) {
		case 'draft':
		case 'policy_checked':
		case 'approval_required':
		case 'approved':
		case 'rejected':
			return null
		case 'queued':
			return 'proposed'
		case 'delivered':
		case 'counterparty_review':
		case 'more_context_required':
			return 'screening'
		case 'accepted':
			return bothMessaged ? 'connected' : 'approved'
		case 'declined':
			return 'declined'
		case 'completed':
			// The protocol terminal for accepted requests: a real two-sided
			// exchange stays a Connection; a fulfilled-without-dialogue request
			// closes as an Encounter that never became one.
			return bothMessaged ? 'connected' : 'closed'
		case 'closed':
			return 'closed'
	}
}

/** Intake origin vocabulary (§6.5) → connection origin vocabulary (§6.6). */
export function connectionOriginForIntake(origin: IntakeOrigin): ConnectionOrigin {
	switch (origin) {
		case 'form':
			return 'link_visit'
		case 'conversation':
			return 'conversation'
		case 'agent':
			return 'agent_call'
		case 'email':
			return 'email_inbound'
	}
}

export function canTransitionRelationship(from: RelationshipState, to: RelationshipState): boolean {
	return RELATIONSHIP_TRANSITIONS[from].includes(to)
}

export function canTransitionAgentRequest(
	from: AgentRequestStatus,
	to: AgentRequestStatus
): boolean {
	return AGENT_REQUEST_TRANSITIONS[from].includes(to)
}

export function canTransitionConsent(from: ConsentStatus, to: ConsentStatus): boolean {
	return CONSENT_TRANSITIONS[from].includes(to)
}

export function canTransitionHandle(from: HandleStatus, to: HandleStatus): boolean {
	return HANDLE_TRANSITIONS[from].includes(to)
}

export function canTransitionSubscription(
	from: SubscriptionStatus,
	to: SubscriptionStatus
): boolean {
	return SUBSCRIPTION_TRANSITIONS[from].includes(to)
}

export function canTransitionIntake(from: IntakeStatus, to: IntakeStatus): boolean {
	return INTAKE_TRANSITIONS[from].includes(to)
}

export function canTransitionReferral(from: ReferralStatus, to: ReferralStatus): boolean {
	return REFERRAL_TRANSITIONS[from].includes(to)
}

export function assertRelationshipTransition(from: RelationshipState, to: RelationshipState): void {
	assertTransition('relationship', from, to, canTransitionRelationship(from, to))
}

export function assertAgentRequestTransition(
	from: AgentRequestStatus,
	to: AgentRequestStatus
): void {
	assertTransition('agent_request', from, to, canTransitionAgentRequest(from, to))
}

export function assertConsentTransition(from: ConsentStatus, to: ConsentStatus): void {
	assertTransition('consent', from, to, canTransitionConsent(from, to))
}

export function assertHandleTransition(from: HandleStatus, to: HandleStatus): void {
	assertTransition('handle', from, to, canTransitionHandle(from, to))
}

export function assertSubscriptionTransition(
	from: SubscriptionStatus,
	to: SubscriptionStatus
): void {
	assertTransition('subscription', from, to, canTransitionSubscription(from, to))
}

export function assertIntakeTransition(from: IntakeStatus, to: IntakeStatus): void {
	assertTransition('intake', from, to, canTransitionIntake(from, to))
}

export function assertReferralTransition(from: ReferralStatus, to: ReferralStatus): void {
	assertTransition('referral', from, to, canTransitionReferral(from, to))
}

function assertTransition(kind: string, from: string, to: string, allowed: boolean): void {
	if (!allowed) {
		throw new AlinkCoreError(
			'INVALID_STATE_TRANSITION',
			`Invalid ${kind} state transition from ${from} to ${to}`
		)
	}
}
