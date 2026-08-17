/**
 * Collaboration — 协作 (docs/alink-collaboration.md Parts C–G, devplan WP-K1).
 *
 * A Collaboration is a RELATIONSHIP, not a Principal (§13). It has no sovereign
 * will: it cannot promise anything, cannot own anyone's data, and cannot outvote
 * a Party into an obligation. Everything it does is bookkeeping on top of
 * authorizations that came from somewhere else — a person's own confirmation,
 * an agent's capability signature, or an organization's internal approval.
 *
 * Three separations do all the work, and every function here exists to keep one
 * of them from collapsing:
 *
 * - **Party ≠ Participant** (§16). The Party bears the consequence; the
 *   Participant merely acts. `seat:*` capabilities can never add up to a Party
 *   power — see `NON_DELEGABLE_PARTY_POWERS`, which is enforced by absence.
 * - **Obligor ≠ Executor** (§24). Reassigning who does the work never moves who
 *   owes it, and never needs anyone else's re-consent.
 * - **Affected ≠ majority** (§18). Whoever's obligation, data, name or access
 *   changes must authorize. There is no `vote()` in this file and there will
 *   not be one.
 *
 * Pure module: no bindings, no keys, no storage.
 */
import { AlinkCoreError } from './errors.js'

// ---------------------------------------------------------------------------
// Scale and lifecycle

/** §14.1 拍板 7. Above this a table is not a table, it is an organization. */
export const PARTY_MAX = 12
export const PARTY_MIN = 2

export type CollaborationState =
	'draft' | 'proposed' | 'active' | 'paused' | 'completed' | 'dissolved' | 'archived'

export const COLLABORATION_TRANSITIONS: Record<CollaborationState, readonly CollaborationState[]> =
	{
		draft: ['proposed', 'dissolved'],
		proposed: ['active', 'dissolved'],
		active: ['paused', 'completed', 'dissolved'],
		paused: ['active', 'completed', 'dissolved'],
		// A completed collaboration can reopen (the work came back) but archiving is
		// the terminal shelf. `dissolved` is separate from `completed` on purpose:
		// one is 「做完了」, the other 「散了」, and the projection must never
		// flatter a table that fell apart into one that finished.
		completed: ['archived', 'active'],
		dissolved: ['archived'],
		archived: []
	}

// ---------------------------------------------------------------------------
// Covenant (§15)

/** §28.1. How much of the past a Party that joined later may read. */
export type HistoryAccess = 'from_join' | 'curated_summary' | 'full_ledger'

export const HISTORY_ACCESS_TIERS: readonly HistoryAccess[] = [
	'from_join',
	'curated_summary',
	'full_ledger'
]

export interface CollaborationCovenant {
	purpose: string
	scope: string
	outOfScope: string
	reviewAt?: number
	admissionPolicy: 'steward_invite' | 'unanimous_party'
	partyExitPolicy: 'unilateral'
	operationalDecisionRule: 'steward' | 'any_party' | 'majority_parties'
	constitutionalDecisionRule: 'all_parties'
	defaultHistoryAccess: HistoryAccess
	publicProjectionPolicy: 'private' | 'opt_in'
	dataPolicy: 'capsule_scoped'
	connectorPolicy: 'reference_only'
	/** TD-10: schema only in v1 — there is no session runtime behind this. */
	glassSessionPolicy: 'disabled' | 'draft_only'
	/** §19.1: lapse-through consent, default OFF and enumerated when on. */
	noObjectionItems: readonly string[]
	version: number
	acceptedByParties: readonly string[]
}

/**
 * §15's floor. These are not covenant FIELDS because they are not choices — a
 * covenant that could switch them off would not be a covenant. They are listed
 * so the invitation screen can show them as facts rather than terms (design
 * prototype D5: 「不可协商的七项权利不列为条款——它们不是选项」) and so a test
 * can fail if somebody later adds a toggle.
 */
export const UNWAIVABLE_COVENANT_RIGHTS = [
	'party_may_exit_unilaterally',
	'affected_party_consent',
	'party_owns_its_own_commitments',
	'party_controls_own_data_and_attribution',
	'ai_authorship_disclosed',
	'unauthorized_context_isolated',
	'shared_facts_append_only',
	'export_and_crypto_erasure'
] as const

export type UnwaivableCovenantRight = (typeof UNWAIVABLE_COVENANT_RIGHTS)[number]

export function defaultCovenant(input: {
	purpose: string
	now: number
	reviewAfterMs?: number
}): CollaborationCovenant {
	return {
		purpose: input.purpose,
		scope: '',
		outOfScope: '',
		reviewAt: input.reviewAfterMs ? input.now + input.reviewAfterMs : undefined,
		admissionPolicy: 'steward_invite',
		partyExitPolicy: 'unilateral',
		operationalDecisionRule: 'steward',
		constitutionalDecisionRule: 'all_parties',
		defaultHistoryAccess: 'from_join',
		publicProjectionPolicy: 'private',
		dataPolicy: 'capsule_scoped',
		connectorPolicy: 'reference_only',
		glassSessionPolicy: 'disabled',
		noObjectionItems: [],
		version: 1,
		acceptedByParties: []
	}
}

// ---------------------------------------------------------------------------
// Party, Seat, Participant (§16)

export type PartyStatus = 'invited' | 'active' | 'suspended' | 'leaving' | 'left' | 'removed'

export const PARTY_TRANSITIONS: Record<PartyStatus, readonly PartyStatus[]> = {
	invited: ['active', 'left', 'removed'],
	active: ['suspended', 'leaving', 'left', 'removed'],
	suspended: ['active', 'leaving', 'left', 'removed'],
	// `leaving` is the window in which open commitments get settled (§28.2);
	// a Party may always complete the exit, and may always change its mind
	// before the exit lands — the right being protected is the exit, not the
	// irreversibility of announcing it.
	leaving: ['left', 'active'],
	left: [],
	removed: []
}

/** The three kinds of principal that can sit at a table (§3.1). */
export type PartyPrincipalType = 'person' | 'agent' | 'organization'

export interface CollaborationParty {
	principalId: string
	principalType: PartyPrincipalType
	status: PartyStatus
	joinedPartyEpoch: number
	historyAccess: HistoryAccess
	acceptedCovenantVersion: number | null
	seatId: string
	joinedAt: number | null
	leftAt?: number
}

export function isPartyLive(status: PartyStatus): boolean {
	return status === 'active' || status === 'suspended' || status === 'leaving'
}

/** §14.1: only ACTIVE parties consume the cap; observers are not parties. */
export function countsTowardPartyCap(status: PartyStatus): boolean {
	return status === 'invited' || status === 'active' || status === 'suspended'
}

export function assertPartyCapacity(currentCount: number): void {
	if (currentCount >= PARTY_MAX) {
		throw new AlinkCoreError(
			'LIMIT_EXCEEDED',
			`A collaboration holds at most ${PARTY_MAX} parties — split it or form an organization`
		)
	}
}

export type SeatState = 'active' | 'frozen' | 'closed'

export const SEAT_TRANSITIONS: Record<SeatState, readonly SeatState[]> = {
	// §30.1 拍板 12: freezing is a server-side risk decision, and thawing needs
	// the organization's controller to prove control again. Both directions exist
	// here; who may drive them does not live in a transition table.
	active: ['frozen', 'closed'],
	frozen: ['active', 'closed'],
	closed: []
}

/** §16.3. What a Participant may do INSIDE a seat. */
export const PARTICIPANT_CAPABILITIES = [
	'seat:read',
	'seat:scribe',
	'seat:propose',
	'seat:deliver',
	'seat:operate_connector',
	'seat:coordinate_agent',
	'seat:steward',
	'seat:represent_party'
] as const

export type ParticipantCapability = (typeof PARTICIPANT_CAPABILITIES)[number]

/**
 * §16.3's second list — powers that no combination of seat capabilities ever
 * produces. They are modelled as strings that are NOT in the capability union,
 * so there is no value a caller could pass to `participantCan` that would grant
 * one. The list exists to be asserted against `PARTICIPANT_CAPABILITIES` in a
 * test: the day someone adds `seat:accept_commitment`, that test fails.
 */
export const NON_DELEGABLE_PARTY_POWERS = [
	'accept_party_commitment',
	'recognize_party_outcome',
	'expand_private_context',
	'publish_person_name',
	'change_constitution'
] as const

export interface CollaborationParticipant {
	id: string
	seatId: string
	/** The Party this participant acts for — never who they ARE. */
	actsForPrincipalId: string
	actorPrincipalId: string
	actorKind: 'person' | 'agent'
	delegationRef?: string
	capabilities: readonly ParticipantCapability[]
	startsAt: number
	expiresAt?: number
	revokedAt?: number
}

export function isParticipantLive(
	participant: Pick<CollaborationParticipant, 'startsAt' | 'expiresAt' | 'revokedAt'>,
	now: number
): boolean {
	if (participant.revokedAt !== undefined && participant.revokedAt <= now) return false
	if (participant.startsAt > now) return false
	return participant.expiresAt === undefined || participant.expiresAt > now
}

export function participantCan(
	participant: Pick<
		CollaborationParticipant,
		'capabilities' | 'startsAt' | 'expiresAt' | 'revokedAt'
	>,
	capability: ParticipantCapability,
	now: number
): boolean {
	if (!isParticipantLive(participant, now)) return false
	return participant.capabilities.includes(capability)
}

/**
 * 拍板 8: an Observer is not a kind of principal, it is a Participant holding
 * exactly one capability. Modelling it as a shape rather than a type is what
 * keeps observers off the Party cap and out of every authorization path.
 */
export function isObserver(capabilities: readonly ParticipantCapability[]): boolean {
	return capabilities.length === 1 && capabilities[0] === 'seat:read'
}

// ---------------------------------------------------------------------------
// Epochs (§35, INV-K1 / INV-K2)

export interface EpochPair {
	partyEpoch: number
	keyEpoch: number
}

/**
 * What kind of change happened, and therefore which keys rotate.
 *
 * This is the single place the two invariants meet, and getting it wrong is
 * expensive in both directions: rotating the Party epoch on a staff change
 * would re-encrypt the whole ledger every time somebody swaps a representative
 * (§35.2's entire reason for existing), while NOT rotating on a Party exit
 * would leave a departed Party able to read what came next.
 */
export type EpochChange =
	/** INV-K1 — a Party joined, left or was removed. Both epochs advance. */
	| { kind: 'party_membership' }
	/** INV-K2 — an organization swapped a Participant. Neither epoch moves; the
	 *  caller rotates that seat's OSK instead. */
	| { kind: 'seat_participant' }

export function nextEpochs(current: EpochPair, change: EpochChange): EpochPair {
	if (change.kind === 'party_membership') {
		return { partyEpoch: current.partyEpoch + 1, keyEpoch: current.keyEpoch + 1 }
	}
	return { ...current }
}

/** INV-K2's other half: a seat's key version advances on participant change. */
export function nextSeatKeyVersion(current: number, change: EpochChange): number {
	return change.kind === 'seat_participant' ? current + 1 : current
}

/**
 * §28.1 / §35.1: which ledger epochs a Party may read, given when it joined and
 * what history tier it was admitted under. Returns the inclusive lower bound —
 * `null` means "summary only, no raw epochs", which is what `curated_summary`
 * buys: a Steward-written digest is not a slice of the ledger.
 */
export function readableEpochFloor(
	party: Pick<CollaborationParty, 'historyAccess' | 'joinedPartyEpoch'>
): number | null {
	switch (party.historyAccess) {
		case 'full_ledger':
			return 0
		case 'from_join':
			return party.joinedPartyEpoch
		case 'curated_summary':
			return null
	}
}

// ---------------------------------------------------------------------------
// Decisions (§18–§19)

export type DecisionKind = 'self' | 'affected_party' | 'operational' | 'constitutional'

export type DecisionProposalStatus =
	'draft' | 'pending' | 'enacted' | 'rejected' | 'expired' | 'superseded'

export const DECISION_PROPOSAL_TRANSITIONS: Record<
	DecisionProposalStatus,
	readonly DecisionProposalStatus[]
> = {
	draft: ['pending', 'rejected'],
	pending: ['enacted', 'rejected', 'expired', 'superseded'],
	enacted: ['superseded'],
	rejected: [],
	expired: [],
	superseded: []
}

/**
 * The material facts a decision changes. `computeAffectedParties` reads exactly
 * these five questions from §18 — no more, no fewer — so that "who has to say
 * yes" is derived from what the decision DOES rather than from who proposed it
 * or who is nearby.
 */
export interface DecisionEffects {
	/** Parties whose obligations increase. */
	obligationIncreased: readonly string[]
	/** Parties whose data gets disclosed further than before. */
	dataDisclosed: readonly string[]
	/** Parties whose name or attribution is used. */
	attributionUsed: readonly string[]
	/** Parties whose access is narrowed or widened. */
	accessChanged: readonly string[]
	/** Parties who carry the downside if this fails. */
	riskBorne: readonly string[]
}

export const EMPTY_DECISION_EFFECTS: DecisionEffects = {
	obligationIncreased: [],
	dataDisclosed: [],
	attributionUsed: [],
	accessChanged: [],
	riskBorne: []
}

export function computeAffectedParties(effects: DecisionEffects): string[] {
	const affected = new Set<string>()
	for (const list of [
		effects.obligationIncreased,
		effects.dataDisclosed,
		effects.attributionUsed,
		effects.accessChanged,
		effects.riskBorne
	]) {
		for (const partyId of list) affected.add(partyId)
	}
	return [...affected].sort()
}

export interface RequiredAuthorizations {
	kind: DecisionKind
	/** Party ids that must authorize for the decision to take effect. */
	parties: readonly string[]
	/** How the requirement was derived, for the decision card's ③ row. */
	rule:
		| 'acting_party_only'
		| 'all_affected_parties'
		| 'covenant_operational_rule'
		| 'all_parties_unanimous'
}

/**
 * §18.1's four rows, resolved. The ORDER is a safety property, not a style
 * choice: a decision that is both operational-looking and touches somebody
 * else's obligation must resolve as affected-party consent, so the affected
 * test runs BEFORE the covenant's operational shortcut is consulted. An
 * operational rule that could absorb an obligation-increasing item would be
 * exactly the 多数暴政 §44 names.
 */
export function requiredAuthorizations(input: {
	kind: DecisionKind
	actingPartyId: string
	effects: DecisionEffects
	activePartyIds: readonly string[]
}): RequiredAuthorizations {
	if (input.kind === 'constitutional') {
		return {
			kind: 'constitutional',
			parties: [...input.activePartyIds].sort(),
			rule: 'all_parties_unanimous'
		}
	}
	const affected = computeAffectedParties(input.effects).filter(
		(partyId) => partyId !== input.actingPartyId
	)
	if (affected.length > 0) {
		return {
			kind: 'affected_party',
			parties: [...new Set([input.actingPartyId, ...affected])].sort(),
			rule: 'all_affected_parties'
		}
	}
	if (input.kind === 'operational') {
		return { kind: 'operational', parties: [], rule: 'covenant_operational_rule' }
	}
	return { kind: 'self', parties: [input.actingPartyId], rule: 'acting_party_only' }
}

/**
 * §19.1 静默不等于同意, as a function so no caller has to remember it. A pending
 * decision that runs out of time becomes `expired` — which is NOT `enacted`.
 * The only exception the covenant may buy is a low-risk operational item that
 * was enumerated in advance AND increases nobody's obligation; every other
 * shape returns `expired` regardless of what the covenant says.
 */
export function decisionOnExpiry(input: {
	kind: DecisionKind
	itemType: string | null
	effects: DecisionEffects
	covenant: Pick<CollaborationCovenant, 'noObjectionItems'>
	objectedByPartyIds: readonly string[]
}): 'enacted' | 'expired' {
	if (input.objectedByPartyIds.length > 0) return 'expired'
	if (input.kind !== 'operational') return 'expired'
	if (input.itemType === null) return 'expired'
	if (!input.covenant.noObjectionItems.includes(input.itemType)) return 'expired'
	if (computeAffectedParties(input.effects).length > 0) return 'expired'
	return 'enacted'
}

// ---------------------------------------------------------------------------
// Authorization requirements, expanded (§18.1 + §15's covenant rules)

/**
 * Every rule in the product that can decide 「够了没有」, named. The list is
 * flat rather than nested under decisions / commitments / outcomes because a
 * projection has to render the reason next to the tally, and a reader asking
 * 「为什么是这些人」 gets one vocabulary instead of three.
 */
export type AuthorizationRule =
	| 'acting_party_only'
	| 'all_affected_parties'
	| 'all_parties_unanimous'
	| 'steward_only'
	| 'any_party'
	| 'majority_parties'
	| 'each_beneficiary'
	| 'two_thirds_plus_open_obligors'
	| 'every_obligor'

/**
 * A requirement reduced to what a stored row can check without re-deriving the
 * rule that produced it: WHO must each say yes, and HOW MANY must have.
 *
 * Both halves are needed and neither implies the other. 「所有受影响方」 is a
 * roster with no count of its own; 「过半数」 is a count with no roster. Storing
 * only the roster would make a majority rule look unanimous, and storing only
 * the count would let three uninvolved parties enact something over the head of
 * the one whose obligation it increases — which is §44's 多数暴政 exactly.
 */
export interface AuthorizationRequirement {
	parties: readonly string[]
	/**
	 * The subset of `parties` that must EACH say yes whatever the tally says,
	 * present only for the rules that are genuinely k-of-n (§27's 2/3 + every
	 * open obligor).
	 *
	 * Without it a rule with a threshold below its roster had nowhere to put the
	 * difference and had to pin a roster of exactly `quorum` names — which turned
	 * 「三方里的任意两方」 into 「最早入座的那两方，缺一不可」: the parties outside
	 * the pinned list were refused, and one of them leaving made the outcome
	 * unrecognizable for good. When it is absent `parties` IS the mandatory set
	 * and nothing about the older rules changes.
	 */
	mandatory?: readonly string[]
	quorum: number
	rule: AuthorizationRule
}

/** §15 `operationalDecisionRule`, expanded against the table as it is now. */
export function operationalRequirement(input: {
	rule: CollaborationCovenant['operationalDecisionRule']
	activePartyIds: readonly string[]
	stewardPartyId: string | null
	actingPartyId: string
}): AuthorizationRequirement {
	switch (input.rule) {
		case 'steward':
			// A table can lose its steward (the convenor may always leave, §15), and
			// succession is by seniority rather than guaranteed. Falling back to the
			// acting party keeps the act possible; falling back to 「nobody」 would
			// turn a lost steward into a rule that authorizes everything.
			return {
				parties: [input.stewardPartyId ?? input.actingPartyId],
				quorum: 1,
				rule: 'steward_only'
			}
		case 'any_party':
			return { parties: [], quorum: 1, rule: 'any_party' }
		case 'majority_parties':
			return {
				parties: [],
				quorum: Math.floor(input.activePartyIds.length / 2) + 1,
				rule: 'majority_parties'
			}
	}
}

/**
 * §18.1's four rows plus the covenant's operational rule, in one answer.
 *
 * The affected test still runs first (inside `requiredAuthorizations`), so a
 * decision that looks operational and touches somebody else's obligation
 * resolves as affected-party consent — the covenant's shortcut never gets to
 * absorb it.
 */
export function decisionRequirement(input: {
	kind: DecisionKind
	actingPartyId: string
	effects: DecisionEffects
	activePartyIds: readonly string[]
	operationalRule: CollaborationCovenant['operationalDecisionRule']
	stewardPartyId: string | null
}): AuthorizationRequirement {
	const required = requiredAuthorizations({
		kind: input.kind,
		actingPartyId: input.actingPartyId,
		effects: input.effects,
		activePartyIds: input.activePartyIds
	})
	switch (required.rule) {
		case 'covenant_operational_rule':
			return operationalRequirement({
				rule: input.operationalRule,
				activePartyIds: input.activePartyIds,
				stewardPartyId: input.stewardPartyId,
				actingPartyId: input.actingPartyId
			})
		case 'acting_party_only':
			return {
				parties: required.parties,
				quorum: required.parties.length,
				rule: 'acting_party_only'
			}
		case 'all_affected_parties':
			return {
				parties: required.parties,
				quorum: required.parties.length,
				rule: 'all_affected_parties'
			}
		case 'all_parties_unanimous':
			return {
				parties: required.parties,
				quorum: required.parties.length,
				rule: 'all_parties_unanimous'
			}
	}
}

/**
 * Who still has to say yes — the parties whose signature no amount of other
 * signatures can replace. Sorted, so a projection and a screen agree.
 *
 * Under a k-of-n rule that is the `mandatory` subset and nobody else: an
 * eligible party who has not signed is not missing, because the requirement
 * never asked for that particular one.
 */
export function missingAuthorizations(
	requirement: Pick<AuthorizationRequirement, 'parties' | 'mandatory'>,
	authorizedPartyIds: readonly string[]
): string[] {
	const authorized = new Set(authorizedPartyIds)
	const required = requirement.mandatory ?? requirement.parties
	return required.filter((partyId) => !authorized.has(partyId)).sort()
}

/**
 * ⚠️ Both halves, and the roster half FIRST. A quorum reached by parties none of
 * whom is the affected one is not consent — it is the majority deciding for
 * somebody else, which no rule in this product may produce.
 */
export function requirementSatisfied(
	requirement: AuthorizationRequirement,
	authorizedPartyIds: readonly string[]
): boolean {
	if (missingAuthorizations(requirement, authorizedPartyIds).length > 0) return false
	const authorized = new Set(authorizedPartyIds)
	// A k-of-n rule counts only the signatures that came from its own eligible
	// roster. Without `mandatory` there is no such roster to intersect with: an
	// empty `parties` is the covenant's quorum rule (anyone at the table), and a
	// named one was already checked above, so the plain tally is the honest count.
	const counted = requirement.mandatory
		? requirement.parties.filter((partyId) => authorized.has(partyId)).length
		: authorized.size
	return counted >= Math.max(requirement.quorum, 1)
}

// ---------------------------------------------------------------------------
// Party authorization (§18.2)

/**
 * The three shapes of a valid Party confirmation. They are not interchangeable
 * and there is no fourth: a Person Party is confirmed by the person, full stop
 * (INV-A2, and the Guardrail 「Person AI 代按事件 = 0」 is this type doing its
 * job at compile time).
 */
export type PartyAuthorization =
	| { principalType: 'person'; confirmationRef: string; confirmedBy: string; at: number }
	| { principalType: 'agent'; capabilitySignatureRef: string; agentDid: string; at: number }
	| { principalType: 'organization'; organizationAuthorizationRef: string; at: number }

export function assertPartyAuthorizationShape(
	party: Pick<CollaborationParty, 'principalType'>,
	authorization: PartyAuthorization
): void {
	if (party.principalType !== authorization.principalType) {
		throw new AlinkCoreError(
			'FORBIDDEN',
			`A ${party.principalType} party cannot be authorized by a ${authorization.principalType} proof`
		)
	}
}

/**
 * 拍板 6 transparency clamp: what other Parties see about someone else's
 * authorization. An organization's internal approvers, thresholds and debate
 * never cross this function — the outside learns 「已有效授权」 or 「内部审批中」
 * and nothing else.
 */
export type PartyAuthorizationView =
	{ state: 'authorized'; at: number } | { state: 'internal_review' } | { state: 'awaiting' }

export function partyAuthorizationView(
	party: Pick<CollaborationParty, 'principalType'>,
	authorization: PartyAuthorization | null,
	hasPendingInternalApproval: boolean
): PartyAuthorizationView {
	if (authorization) return { state: 'authorized', at: authorization.at }
	if (party.principalType === 'organization' && hasPendingInternalApproval) {
		return { state: 'internal_review' }
	}
	return { state: 'awaiting' }
}

// ---------------------------------------------------------------------------
// Commitments (§23–§26)

export type CommitmentState =
	'proposed' | 'open' | 'revision_pending' | 'fulfillment_claimed' | 'recognized' | 'released'

export const COMMITMENT_TRANSITIONS: Record<CommitmentState, readonly CommitmentState[]> = {
	// §23's list starts at `open` because that is where a COMMITMENT starts —
	// but `commitment_proposed` and `commitment_partially_authorized` are both
	// ledger events (§21.2), so the window between them is a real place a row
	// sits in. Naming it keeps 「提议了但还没有人承诺」 from being spelled as an
	// `open` commitment with an empty authorization list, which is what every
	// later reader would have to remember to check.
	proposed: ['open', 'released'],
	open: ['revision_pending', 'fulfillment_claimed', 'released'],
	revision_pending: ['open', 'released'],
	// The whole model in one row: a claim is not a fulfilment. Claiming can be
	// walked back to `open` (the work was not done after all) and only the
	// beneficiary's recognition moves it forward (§26).
	fulfillment_claimed: ['recognized', 'open', 'released'],
	recognized: [],
	released: []
}

export interface Commitment {
	id: string
	collaborationId: string
	obligorPartyIds: readonly string[]
	/** Explicit beneficiaries, or the collaboration as a whole (§23). */
	beneficiary: { kind: 'parties'; partyIds: readonly string[] } | { kind: 'collaboration' }
	text: string
	dueAt?: number
	successCondition?: string
	dependsOn?: readonly string[]
	partyAuthorizations: readonly string[]
	state: CommitmentState
	version: number
}

/**
 * §25, and the hardest line in the product to keep: passing `dueAt` produces a
 * NEUTRAL statement of fact, never a failure. There is no `lapsed` state, no
 * score, no colour change — the function returns a shape the UI can render grey
 * (design prototype D4: 「原定日期已过」是灰度章，不变色不置顶).
 */
export type CommitmentTimingView =
	| { kind: 'no_due_date' }
	| { kind: 'due'; dueAt: number }
	| { kind: 'past_due'; dueAt: number; sinceMs: number }

export function commitmentTiming(
	commitment: Pick<Commitment, 'dueAt' | 'state'>,
	now: number
): CommitmentTimingView {
	if (commitment.dueAt === undefined) return { kind: 'no_due_date' }
	// A settled commitment has no timing story left to tell — showing 「已过期」
	// on something already recognized would invent a failure out of bookkeeping.
	// A `proposed` one has no story YET: nobody has promised the date, so
	// 「原定日期已过」 would report a lapse against an obligation that does not
	// exist.
	if (
		commitment.state === 'recognized' ||
		commitment.state === 'released' ||
		commitment.state === 'proposed'
	) {
		return { kind: 'due', dueAt: commitment.dueAt }
	}
	if (commitment.dueAt > now) return { kind: 'due', dueAt: commitment.dueAt }
	return { kind: 'past_due', dueAt: commitment.dueAt, sinceMs: now - commitment.dueAt }
}

/**
 * §24: who must re-authorize when a commitment changes. Returns an empty list
 * for an executor swap — that is the whole point of the Party/Executor split,
 * and stating it as a case here is cheaper than trusting every call site to
 * remember (§44 承诺偷换).
 */
export type CommitmentChange =
	| { kind: 'executor_reassigned' }
	| { kind: 'due_date_moved' }
	| { kind: 'released' }
	| { kind: 'obligor_transferred'; fromPartyId: string; toPartyId: string }
	| { kind: 'success_condition_narrowed' }

export function reauthorizationRequiredFor(
	commitment: Pick<Commitment, 'obligorPartyIds' | 'beneficiary'>,
	change: CommitmentChange
): string[] {
	const beneficiaries =
		commitment.beneficiary.kind === 'parties' ? commitment.beneficiary.partyIds : []
	switch (change.kind) {
		case 'executor_reassigned':
			return []
		case 'due_date_moved':
		case 'released':
			return [...new Set([...commitment.obligorPartyIds, ...beneficiaries])].sort()
		case 'obligor_transferred':
			return [
				...new Set([...commitment.obligorPartyIds, change.toPartyId, ...beneficiaries])
			].sort()
		case 'success_condition_narrowed':
			return [...new Set([...commitment.obligorPartyIds, ...beneficiaries])].sort()
	}
}

/**
 * §26 recognition rule. The `collaboration` beneficiary case defers to the
 * covenant's operational rule, but any Party that carries direct downside can
 * pull it back to affected-party consent — expressed as an input rather than
 * inferred, because "who got hurt" is not something a schema knows.
 */
export function recognizersFor(
	commitment: Pick<Commitment, 'beneficiary'>,
	options: { activePartyIds: readonly string[]; escalatedByPartyIds?: readonly string[] }
): { parties: readonly string[]; rule: 'each_beneficiary' | 'covenant_operational_rule' } {
	if (commitment.beneficiary.kind === 'parties') {
		return { parties: [...commitment.beneficiary.partyIds].sort(), rule: 'each_beneficiary' }
	}
	const escalated = options.escalatedByPartyIds ?? []
	if (escalated.length > 0) {
		return { parties: [...new Set(escalated)].sort(), rule: 'each_beneficiary' }
	}
	return { parties: [], rule: 'covenant_operational_rule' }
}

/**
 * §23.4 联合承诺: EVERY requested obligor, and the quorum equals the roster —
 * 「缺一不可」 has no numeric shortcut. A commitment that took three of four
 * obligors would be a commitment somebody is on the hook for without having
 * said so.
 */
export function commitmentRequirement(
	obligorPartyIds: readonly string[]
): AuthorizationRequirement {
	const parties = [...new Set(obligorPartyIds)].sort()
	return { parties, quorum: parties.length, rule: 'every_obligor' }
}

/** §26, with the covenant's operational rule standing in when the beneficiary
 * is the collaboration itself and nobody has escalated. */
export function recognitionRequirement(input: {
	commitment: Pick<Commitment, 'beneficiary'>
	activePartyIds: readonly string[]
	operationalRule: CollaborationCovenant['operationalDecisionRule']
	stewardPartyId: string | null
	actingPartyId: string
	escalatedByPartyIds?: readonly string[]
}): AuthorizationRequirement {
	const recognizers = recognizersFor(input.commitment, {
		activePartyIds: input.activePartyIds,
		...(input.escalatedByPartyIds ? { escalatedByPartyIds: input.escalatedByPartyIds } : {})
	})
	if (recognizers.rule === 'each_beneficiary') {
		return {
			parties: recognizers.parties,
			quorum: recognizers.parties.length,
			rule: 'each_beneficiary'
		}
	}
	return operationalRequirement({
		rule: input.operationalRule,
		activePartyIds: input.activePartyIds,
		stewardPartyId: input.stewardPartyId,
		actingPartyId: input.actingPartyId
	})
}

// ---------------------------------------------------------------------------
// Outcomes (§27)

export interface OutcomeRecognitionRule {
	/** Everyone whose recognition COUNTS — the population the threshold is
	 * measured against, and therefore also the admission list. */
	parties: readonly string[]
	/** The subset that must each recognize however the tally lands. */
	mandatory: readonly string[]
	/** How many of `parties` have to have signed. */
	quorum: number
	rule: 'covenant_operational_rule' | 'two_thirds_plus_open_obligors' | 'each_signed_party'
}

/**
 * §27 default for a collaboration's final outcome: 2/3 + every open obligor.
 *
 * The two halves are counted SEPARATELY on purpose, and the shape says so: the
 * open obligors are `mandatory` — no other party's yes can stand in for theirs —
 * while the 2/3 is a THRESHOLD over every active party, filled by whichever of
 * them actually signs.
 *
 * ⚠️ Naming ⌈2n/3⌉ specific parties instead would not be the same rule. Any
 * such list is picked by something the rule never mentions (join order, in this
 * object's case), and it turns 「三方里的任意两方」 into unanimity of a chosen
 * two: the third party is refused if it tries to recognize, the two who were
 * picked cannot be replaced by the two who agree, and one of them leaving makes
 * the outcome permanently unrecognizable.
 */
export function finalOutcomeRecognizers(input: {
	activePartyIds: readonly string[]
	openObligorPartyIds: readonly string[]
}): OutcomeRecognitionRule {
	const mandatory = [...new Set(input.openObligorPartyIds)].sort()
	// An obligor that has left the table (§28.2 settles obligations during
	// `leaving`, not before) is still owed its say, so it stays on the list it is
	// admitted by — it simply never arrives, and the outcome waits, which is the
	// honest reading of 「还有人欠着东西」.
	const eligible = [...new Set([...input.activePartyIds, ...mandatory])].sort()
	const threshold = Math.ceil((input.activePartyIds.length * 2) / 3)
	return {
		parties: eligible,
		mandatory,
		// The mandatory half can outnumber the threshold. Reporting the larger of
		// the two keeps the number a screen renders next to 「已认可 x/y」 from
		// understating what the outcome actually needs.
		quorum: Math.max(threshold, mandatory.length),
		rule: 'two_thirds_plus_open_obligors'
	}
}

/** §27's two shapes: a milestone follows the covenant's operational rule, the
 * collaboration's completion follows 2/3 + every open obligor. */
export function outcomeRequirement(input: {
	scope: 'milestone' | 'final'
	activePartyIds: readonly string[]
	openObligorPartyIds: readonly string[]
	operationalRule: CollaborationCovenant['operationalDecisionRule']
	stewardPartyId: string | null
	actingPartyId: string
}): AuthorizationRequirement {
	if (input.scope === 'milestone') {
		return operationalRequirement({
			rule: input.operationalRule,
			activePartyIds: input.activePartyIds,
			stewardPartyId: input.stewardPartyId,
			actingPartyId: input.actingPartyId
		})
	}
	const final = finalOutcomeRecognizers({
		activePartyIds: input.activePartyIds,
		openObligorPartyIds: input.openObligorPartyIds
	})
	return {
		parties: final.parties,
		mandatory: final.mandatory,
		quorum: final.quorum,
		rule: 'two_thirds_plus_open_obligors'
	}
}

/**
 * §27 / INV-C5 / §41.2: publishing an outcome needs each named Party's own
 * opt-in, and when a named party is a natural person INSIDE an organization,
 * that person opts in too. Two consents, checked separately — an organization
 * saying yes on someone's behalf is exactly the 公开冒名 threat.
 */
export function publicationConsentMissing(input: {
	namedPartyIds: readonly string[]
	namedPersonIds: readonly string[]
	partyOptIns: readonly string[]
	personOptIns: readonly string[]
}): { parties: string[]; persons: string[] } {
	return {
		parties: input.namedPartyIds.filter((id) => !input.partyOptIns.includes(id)).sort(),
		persons: input.namedPersonIds.filter((id) => !input.personOptIns.includes(id)).sort()
	}
}

// ---------------------------------------------------------------------------
// Ledger (§21)

/** §21.2's full table. There is no `note`, `message` or `ai_update` — ordinary
 * conversation belongs in a Thread or an external tool (§21.2 last line). */
export const LEDGER_EVENT_KINDS = [
	'covenant_proposed',
	'covenant_accepted',
	'covenant_superseded',
	'party_invited',
	'party_joined',
	'party_suspended',
	'party_left',
	'party_removed',
	'seat_delegated',
	'seat_revoked',
	'seat_frozen',
	'seat_restored',
	'context_shared',
	'context_revised',
	'context_revoked',
	'decision_proposed',
	'decision_authorized',
	'decision_enacted',
	'decision_opposed',
	'decision_expired',
	'decision_superseded',
	'commitment_proposed',
	'commitment_partially_authorized',
	'commitment_accepted',
	'commitment_revised',
	'commitment_released',
	'deliverable_shared',
	'deliverable_revised',
	'deliverable_revoked',
	'fulfillment_claimed',
	'fulfillment_recognized',
	'outcome_proposed',
	'outcome_recognized',
	'agent_granted',
	'agent_revoked',
	'connector_linked',
	'glass_session_recorded',
	'paused',
	'resumed',
	'completed',
	'dissolved',
	'archived'
] as const

export type LedgerEventKind = (typeof LEDGER_EVENT_KINDS)[number]

export function isLedgerEventKind(value: unknown): value is LedgerEventKind {
	return typeof value === 'string' && (LEDGER_EVENT_KINDS as readonly string[]).includes(value)
}

/** §21.1. WHO wrote it — and, separately, who they were writing for. */
export interface Authorship {
	generatedBy: string
	actsForPartyId: string
	/** Present when an AI produced the content. Rendered, always (INV-A1). */
	viaAgent?: string
}

/** §21.1. WHY they were allowed to. At least one member must be present. */
export interface Authority {
	personConfirmationRef?: string
	agentCapabilityRef?: string
	organizationAuthorizationRef?: string
	seatGrantRef?: string
	collaborationDecisionRef?: string
	/**
	 * §30.1 拍板 12: the server's own risk control froze a seat. It is a member of
	 * this union rather than a borrowed one because the alternative is a lie —
	 * a platform freeze written as a person's confirmation or a party's seat
	 * grant would attribute to somebody at the table a decision the product
	 * document deliberately keeps away from them. It never appears on a
	 * party-binding event: alink does not authorize anything in anyone's name.
	 */
	riskControlRef?: string
}

/**
 * Ledger event kinds that are a PARTY's word rather than a scribe's note. These
 * may not rest on a seat grant alone: writing 「Studio X commits」 into the
 * shared record requires the authority that makes it Studio X's commitment.
 */
export const PARTY_BINDING_EVENT_KINDS: readonly LedgerEventKind[] = [
	'covenant_accepted',
	'party_joined',
	'party_left',
	'decision_authorized',
	'commitment_accepted',
	'commitment_released',
	'fulfillment_recognized',
	'outcome_recognized'
]

/**
 * INV-A1 as a gate. Two separate failures, deliberately distinguished:
 * authorship with no authority is an unattributed write, while a party-binding
 * event resting only on `seatGrantRef` is a Participant having quietly become
 * a Party (INV-C2) — the second is the one that would be hard to see later.
 */
export function assertLedgerEventAuthority(
	kind: LedgerEventKind,
	authorship: Authorship,
	authority: Authority
): void {
	if (!authorship.generatedBy || !authorship.actsForPartyId) {
		throw new AlinkCoreError('INVALID_ARGUMENT', 'A ledger event needs an authorship')
	}
	const proofs = [
		authority.personConfirmationRef,
		authority.agentCapabilityRef,
		authority.organizationAuthorizationRef,
		authority.seatGrantRef,
		authority.collaborationDecisionRef,
		authority.riskControlRef
	].filter((ref) => typeof ref === 'string' && ref.length > 0)
	if (proofs.length === 0) {
		throw new AlinkCoreError('FORBIDDEN', 'A ledger event needs an authority')
	}
	if (!PARTY_BINDING_EVENT_KINDS.includes(kind)) return
	// ⚠️ Not `??`: an empty-string ref is not nullish, so a chain would stop at
	// `personConfirmationRef: ''` and hide a valid agent or organization proof
	// behind it. The `proofs` filter above already treats '' as absent — this
	// asks the same question of the same values.
	const partyProof = [
		authority.personConfirmationRef,
		authority.agentCapabilityRef,
		authority.organizationAuthorizationRef,
		authority.collaborationDecisionRef
	].find((ref) => typeof ref === 'string' && ref.length > 0)
	if (!partyProof) {
		throw new AlinkCoreError(
			'FORBIDDEN',
			`${kind} binds a party and cannot rest on a seat grant alone`
		)
	}
}

export interface CollaborationEventHeader {
	id: string
	collaborationId: string
	sequence: number
	partyEpoch: number
	keyEpoch: number
	kind: LedgerEventKind
	authorship: Authorship
	authority: Authority
	visibility: 'parties' | 'seat'
	createdAt: number
	supersedes?: string
}

// ---------------------------------------------------------------------------
// Context Capsule (§22, §35.3)

export type CapsuleUsage = 'human_read' | 'agent_read' | 'connector_use'

export const CAPSULE_USAGES: readonly CapsuleUsage[] = ['human_read', 'agent_read', 'connector_use']

export interface CapsuleReader {
	kind: 'party' | 'participant' | 'agent'
	ref: string
	usage: readonly CapsuleUsage[]
}

export interface ContextCapsule {
	id: string
	collaborationId: string
	ownerPartyId: string
	suppliedByParticipantId?: string
	purpose: string
	readers: readonly CapsuleReader[]
	startsAt: number
	expiresAt?: number
	revocable: boolean
	revokedAt?: number
	version: number
	authorizationRef?: string
}

/**
 * §22.1's sharpest line, made mechanical: granting a Party does NOT grant its
 * members. A capsule readable by an organization Party is readable through that
 * Party's SEAT, and the organization still has to distribute it inward — so a
 * reader check that walked from party → all participants would be the bug.
 * This function never does that walk; participants must be named.
 */
export function capsuleReadableBy(
	capsule: Pick<ContextCapsule, 'readers' | 'startsAt' | 'expiresAt' | 'revokedAt'>,
	reader: { kind: CapsuleReader['kind']; ref: string; usage: CapsuleUsage },
	now: number
): boolean {
	if (capsule.revokedAt !== undefined && capsule.revokedAt <= now) return false
	if (capsule.startsAt > now) return false
	if (capsule.expiresAt !== undefined && capsule.expiresAt <= now) return false
	return capsule.readers.some(
		(entry) =>
			entry.kind === reader.kind && entry.ref === reader.ref && entry.usage.includes(reader.usage)
	)
}

// ---------------------------------------------------------------------------
// Deliberately absent (§52)

export const DELIBERATELY_ABSENT_COLLAB_TOOLS = [
	'collab.accept_for_person',
	'collab.bind_unaffected_party',
	'collab.recognize_without_party_auth',
	'collab.expand_context_readers',
	'collab.publish_member_without_opt_in'
] as const

// ---------------------------------------------------------------------------
// Transition guards

export function canTransitionCollaboration(
	from: CollaborationState,
	to: CollaborationState
): boolean {
	return COLLABORATION_TRANSITIONS[from].includes(to)
}

export function assertCollaborationTransition(
	from: CollaborationState,
	to: CollaborationState
): void {
	assertTransition('collaboration', from, to, canTransitionCollaboration(from, to))
}

export function canTransitionParty(from: PartyStatus, to: PartyStatus): boolean {
	return PARTY_TRANSITIONS[from].includes(to)
}

export function assertPartyTransition(from: PartyStatus, to: PartyStatus): void {
	assertTransition('party', from, to, canTransitionParty(from, to))
}

export function canTransitionSeat(from: SeatState, to: SeatState): boolean {
	return SEAT_TRANSITIONS[from].includes(to)
}

export function assertSeatTransition(from: SeatState, to: SeatState): void {
	assertTransition('seat', from, to, canTransitionSeat(from, to))
}

export function canTransitionDecisionProposal(
	from: DecisionProposalStatus,
	to: DecisionProposalStatus
): boolean {
	return DECISION_PROPOSAL_TRANSITIONS[from].includes(to)
}

export function assertDecisionProposalTransition(
	from: DecisionProposalStatus,
	to: DecisionProposalStatus
): void {
	assertTransition('decision', from, to, canTransitionDecisionProposal(from, to))
}

export function canTransitionCommitment(from: CommitmentState, to: CommitmentState): boolean {
	return COMMITMENT_TRANSITIONS[from].includes(to)
}

export function assertCommitmentTransition(from: CommitmentState, to: CommitmentState): void {
	assertTransition('commitment', from, to, canTransitionCommitment(from, to))
}

function assertTransition(kind: string, from: string, to: string, allowed: boolean): void {
	if (!allowed) {
		throw new AlinkCoreError(
			'INVALID_STATE_TRANSITION',
			`Invalid ${kind} state transition from ${from} to ${to}`
		)
	}
}
