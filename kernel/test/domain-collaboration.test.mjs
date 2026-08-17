import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
	AlinkCoreError,
	COLLABORATION_TRANSITIONS,
	COMMITMENT_TRANSITIONS,
	DECISION_PROPOSAL_TRANSITIONS,
	DELIBERATELY_ABSENT_COLLAB_TOOLS,
	EMPTY_DECISION_EFFECTS,
	HISTORY_ACCESS_TIERS,
	LEDGER_EVENT_KINDS,
	MCP_TOOL_DEFINITIONS,
	NON_DELEGABLE_PARTY_POWERS,
	PARTICIPANT_CAPABILITIES,
	PARTY_BINDING_EVENT_KINDS,
	PARTY_MAX,
	PARTY_MIN,
	UNWAIVABLE_COVENANT_RIGHTS,
	assertCollaborationTransition,
	assertCommitmentTransition,
	assertDecisionProposalTransition,
	assertLedgerEventAuthority,
	assertPartyAuthorizationShape,
	assertPartyCapacity,
	assertPartyTransition,
	assertSeatTransition,
	capsuleReadableBy,
	commitmentTiming,
	computeAffectedParties,
	countsTowardPartyCap,
	decisionOnExpiry,
	defaultCovenant,
	finalOutcomeRecognizers,
	isLedgerEventKind,
	isObserver,
	isParticipantLive,
	isPartyLive,
	nextEpochs,
	nextSeatKeyVersion,
	participantCan,
	partyAuthorizationView,
	publicationConsentMissing,
	readableEpochFloor,
	reauthorizationRequiredFor,
	recognizersFor,
	requiredAuthorizations,
	commitmentRequirement,
	decisionRequirement,
	missingAuthorizations,
	operationalRequirement,
	outcomeRequirement,
	recognitionRequirement,
	requirementSatisfied
} from '../src/index.js'

const NOW = 1_760_000_000_000

// ---------------------------------------------------------------------------
// Scale and lifecycle

test('§14.1 拍板 7: the party cap is 12', () => {
	assert.equal(PARTY_MAX, 12)
	assert.equal(PARTY_MIN, 2)
	assert.doesNotThrow(() => assertPartyCapacity(11))
	assert.throws(() => assertPartyCapacity(12), /at most 12 parties/)
})

test('a table that fell apart is never projected as one that finished', () => {
	assert.doesNotThrow(() => assertCollaborationTransition('active', 'completed'))
	assert.doesNotThrow(() => assertCollaborationTransition('active', 'dissolved'))
	assert.throws(() => assertCollaborationTransition('dissolved', 'completed'), AlinkCoreError)
	assert.throws(() => assertCollaborationTransition('archived', 'active'), AlinkCoreError)
	assert.deepEqual(COLLABORATION_TRANSITIONS.archived, [])
})

test('a party may always finish leaving, and may always change its mind first', () => {
	assert.doesNotThrow(() => assertPartyTransition('leaving', 'left'))
	assert.doesNotThrow(() => assertPartyTransition('leaving', 'active'))
	assert.throws(() => assertPartyTransition('left', 'active'), AlinkCoreError)
	assert.throws(() => assertPartyTransition('removed', 'active'), AlinkCoreError)
	assert.equal(isPartyLive('active'), true)
	assert.equal(isPartyLive('leaving'), true)
	assert.equal(isPartyLive('left'), false)
	assert.equal(countsTowardPartyCap('invited'), true)
	assert.equal(countsTowardPartyCap('left'), false)
})

test('拍板 12: a frozen seat can thaw, a closed one cannot', () => {
	assert.doesNotThrow(() => assertSeatTransition('active', 'frozen'))
	assert.doesNotThrow(() => assertSeatTransition('frozen', 'active'))
	assert.throws(() => assertSeatTransition('closed', 'active'), AlinkCoreError)
})

// ---------------------------------------------------------------------------
// Covenant

test('the default covenant is private, unanimous-constitutional and no-lapse', () => {
	const covenant = defaultCovenant({ purpose: 'Ship the demo', now: NOW })
	assert.equal(covenant.publicProjectionPolicy, 'private')
	assert.equal(covenant.constitutionalDecisionRule, 'all_parties')
	assert.equal(covenant.partyExitPolicy, 'unilateral')
	assert.equal(covenant.defaultHistoryAccess, 'from_join')
	assert.equal(covenant.glassSessionPolicy, 'disabled')
	// §19.1: lapse-through consent is OFF and enumerated when on.
	assert.deepEqual(covenant.noObjectionItems, [])
	assert.equal(covenant.reviewAt, undefined)
})

test('§15: the eight unwaivable rights are data, not prose', () => {
	assert.equal(UNWAIVABLE_COVENANT_RIGHTS.length, 8)
	assert.ok(UNWAIVABLE_COVENANT_RIGHTS.includes('party_may_exit_unilaterally'))
	assert.ok(UNWAIVABLE_COVENANT_RIGHTS.includes('shared_facts_append_only'))
	// The covenant must expose no field that could switch one of these off.
	const covenant = defaultCovenant({ purpose: 'x', now: NOW })
	for (const right of UNWAIVABLE_COVENANT_RIGHTS) {
		assert.equal(Object.hasOwn(covenant, right), false, `${right} must not be a covenant field`)
	}
})

// ---------------------------------------------------------------------------
// Participants (§16.3), INV-C2

test('§16.3: no seat capability is a party power', () => {
	for (const power of NON_DELEGABLE_PARTY_POWERS) {
		assert.equal(
			PARTICIPANT_CAPABILITIES.includes(power),
			false,
			`${power} must never be a seat capability`
		)
		assert.equal(PARTICIPANT_CAPABILITIES.includes(`seat:${power}`), false)
	}
	assert.equal(PARTICIPANT_CAPABILITIES.length, 8)
})

test('participant capability checks respect the participant window', () => {
	const live = { capabilities: ['seat:scribe'], startsAt: NOW - 1 }
	assert.equal(participantCan(live, 'seat:scribe', NOW), true)
	assert.equal(participantCan(live, 'seat:deliver', NOW), false)
	assert.equal(participantCan({ ...live, revokedAt: NOW }, 'seat:scribe', NOW), false)
	assert.equal(participantCan({ ...live, expiresAt: NOW }, 'seat:scribe', NOW), false)
	assert.equal(participantCan({ ...live, startsAt: NOW + 1 }, 'seat:scribe', NOW), false)
	assert.equal(isParticipantLive(live, NOW), true)
})

test('拍板 8: an observer is read-only and nothing else', () => {
	assert.equal(isObserver(['seat:read']), true)
	assert.equal(isObserver(['seat:read', 'seat:scribe']), false)
	assert.equal(isObserver([]), false)
})

// ---------------------------------------------------------------------------
// Epochs (INV-K1 / INV-K2)

test('INV-K1: a party change rotates both epochs', () => {
	assert.deepEqual(nextEpochs({ partyEpoch: 3, keyEpoch: 7 }, { kind: 'party_membership' }), {
		partyEpoch: 4,
		keyEpoch: 8
	})
})

test('INV-K2: a participant swap rotates the seat key and nothing else', () => {
	const before = { partyEpoch: 3, keyEpoch: 7 }
	assert.deepEqual(nextEpochs(before, { kind: 'seat_participant' }), before)
	assert.equal(nextSeatKeyVersion(2, { kind: 'seat_participant' }), 3)
	assert.equal(nextSeatKeyVersion(2, { kind: 'party_membership' }), 2)
})

test('§28.1: history access decides which epochs are readable', () => {
	assert.equal(readableEpochFloor({ historyAccess: 'full_ledger', joinedPartyEpoch: 5 }), 0)
	assert.equal(readableEpochFloor({ historyAccess: 'from_join', joinedPartyEpoch: 5 }), 5)
	// A curated summary is not a slice of the ledger — no epoch is readable.
	assert.equal(readableEpochFloor({ historyAccess: 'curated_summary', joinedPartyEpoch: 5 }), null)
	assert.equal(HISTORY_ACCESS_TIERS.length, 3)
})

// ---------------------------------------------------------------------------
// Decisions (§18)

const PARTIES = ['p_yan', 'p_studiox', 'p_acme']

test('§18: affected parties are computed from what the decision does', () => {
	assert.deepEqual(computeAffectedParties(EMPTY_DECISION_EFFECTS), [])
	assert.deepEqual(
		computeAffectedParties({
			...EMPTY_DECISION_EFFECTS,
			obligationIncreased: ['p_acme'],
			attributionUsed: ['p_yan', 'p_acme']
		}),
		['p_acme', 'p_yan']
	)
})

test('a self action needs only the acting party', () => {
	const result = requiredAuthorizations({
		kind: 'self',
		actingPartyId: 'p_studiox',
		effects: EMPTY_DECISION_EFFECTS,
		activePartyIds: PARTIES
	})
	assert.equal(result.kind, 'self')
	assert.deepEqual(result.parties, ['p_studiox'])
	assert.equal(result.rule, 'acting_party_only')
})

test('§18.1 order: an operational item that touches someone else escalates', () => {
	const result = requiredAuthorizations({
		kind: 'operational',
		actingPartyId: 'p_studiox',
		effects: { ...EMPTY_DECISION_EFFECTS, obligationIncreased: ['p_acme'] },
		activePartyIds: PARTIES
	})
	// This is the 多数暴政 guard: it must NOT resolve as an operational shortcut.
	assert.equal(result.kind, 'affected_party')
	assert.deepEqual(result.parties, ['p_acme', 'p_studiox'])
})

test('a genuinely operational item defers to the covenant rule', () => {
	const result = requiredAuthorizations({
		kind: 'operational',
		actingPartyId: 'p_studiox',
		effects: EMPTY_DECISION_EFFECTS,
		activePartyIds: PARTIES
	})
	assert.equal(result.kind, 'operational')
	assert.deepEqual(result.parties, [])
	assert.equal(result.rule, 'covenant_operational_rule')
})

test('a constitutional decision is unanimous and takes no shortcut', () => {
	const result = requiredAuthorizations({
		kind: 'constitutional',
		actingPartyId: 'p_yan',
		effects: EMPTY_DECISION_EFFECTS,
		activePartyIds: PARTIES
	})
	assert.equal(result.rule, 'all_parties_unanimous')
	assert.deepEqual(result.parties, ['p_acme', 'p_studiox', 'p_yan'])
})

test('§19.1: silence is not consent', () => {
	const covenant = { noObjectionItems: ['retro_date'] }
	const base = {
		kind: 'operational',
		itemType: 'retro_date',
		effects: EMPTY_DECISION_EFFECTS,
		covenant,
		objectedByPartyIds: []
	}
	// The one narrow case the covenant may buy…
	assert.equal(decisionOnExpiry(base), 'enacted')
	// …and every way out of it.
	assert.equal(decisionOnExpiry({ ...base, objectedByPartyIds: ['p_acme'] }), 'expired')
	assert.equal(decisionOnExpiry({ ...base, kind: 'affected_party' }), 'expired')
	assert.equal(decisionOnExpiry({ ...base, kind: 'constitutional' }), 'expired')
	assert.equal(decisionOnExpiry({ ...base, itemType: 'tool_choice' }), 'expired')
	assert.equal(decisionOnExpiry({ ...base, itemType: null }), 'expired')
	assert.equal(
		decisionOnExpiry({
			...base,
			effects: { ...EMPTY_DECISION_EFFECTS, obligationIncreased: ['p_acme'] }
		}),
		'expired'
	)
	// Default covenant has no enumerated items at all, so nothing lapses through.
	assert.equal(decisionOnExpiry({ ...base, covenant: { noObjectionItems: [] } }), 'expired')
})

test('decision status machine has no path from expired to enacted', () => {
	assert.doesNotThrow(() => assertDecisionProposalTransition('pending', 'expired'))
	assert.throws(() => assertDecisionProposalTransition('expired', 'enacted'), AlinkCoreError)
	assert.deepEqual(DECISION_PROPOSAL_TRANSITIONS.rejected, [])
})

// ---------------------------------------------------------------------------
// Authorization requirements (§18.1 + §15's covenant rules), WP-K6

const REQUIREMENT_BASE = {
	activePartyIds: PARTIES,
	operationalRule: 'steward',
	stewardPartyId: 'p_yan',
	actingPartyId: 'p_studiox'
}

test('§18.1: each row expands to a roster and a count that agree', () => {
	const self = decisionRequirement({
		...REQUIREMENT_BASE,
		kind: 'self',
		effects: EMPTY_DECISION_EFFECTS
	})
	assert.deepEqual(self, { parties: ['p_studiox'], quorum: 1, rule: 'acting_party_only' })

	const constitutional = decisionRequirement({
		...REQUIREMENT_BASE,
		kind: 'constitutional',
		effects: EMPTY_DECISION_EFFECTS
	})
	assert.equal(constitutional.rule, 'all_parties_unanimous')
	assert.equal(constitutional.quorum, PARTIES.length)

	// The affected test still runs first: an operational-looking item that adds
	// to somebody else's obligation resolves as affected-party consent, and the
	// covenant's shortcut never gets to absorb it.
	const affected = decisionRequirement({
		...REQUIREMENT_BASE,
		kind: 'operational',
		effects: { ...EMPTY_DECISION_EFFECTS, obligationIncreased: ['p_acme'] }
	})
	assert.equal(affected.rule, 'all_affected_parties')
	assert.deepEqual(affected.parties, ['p_acme', 'p_studiox'])
	assert.equal(affected.quorum, 2)
})

test('§15: the covenant’s operational rule decides only the untouched case', () => {
	const steward = decisionRequirement({
		...REQUIREMENT_BASE,
		kind: 'operational',
		effects: EMPTY_DECISION_EFFECTS
	})
	assert.deepEqual(steward, { parties: ['p_yan'], quorum: 1, rule: 'steward_only' })

	assert.deepEqual(operationalRequirement({ ...REQUIREMENT_BASE, rule: 'any_party' }), {
		parties: [],
		quorum: 1,
		rule: 'any_party'
	})
	// Three parties: two is a majority, and the roster stays empty because
	// 「过半数」 names nobody in particular.
	assert.deepEqual(operationalRequirement({ ...REQUIREMENT_BASE, rule: 'majority_parties' }), {
		parties: [],
		quorum: 2,
		rule: 'majority_parties'
	})
	// A table that lost its steward falls back to the acting party, never to
	// 「nobody has to agree」.
	assert.deepEqual(
		operationalRequirement({ ...REQUIREMENT_BASE, rule: 'steward', stewardPartyId: null }).parties,
		['p_studiox']
	)
})

test('§44: a quorum without the affected party is not consent', () => {
	const affected = { parties: ['p_yan', 'p_acme'], quorum: 2, rule: 'all_affected_parties' }
	assert.equal(requirementSatisfied(affected, ['p_yan', 'p_studiox']), false)
	assert.deepEqual(missingAuthorizations(affected, ['p_yan', 'p_studiox']), ['p_acme'])
	assert.equal(requirementSatisfied(affected, ['p_yan', 'p_acme']), true)

	// A pure count still needs the count, and an empty roster never means
	// 「anyone will do, including nobody」.
	const majority = { parties: [], quorum: 2, rule: 'majority_parties' }
	assert.equal(requirementSatisfied(majority, ['p_yan']), false)
	assert.equal(requirementSatisfied(majority, ['p_yan', 'p_acme']), true)
	assert.equal(requirementSatisfied({ parties: [], quorum: 0, rule: 'any_party' }, []), false)
})

test('§23.4 联合承诺: every obligor, with no numeric shortcut', () => {
	const joint = commitmentRequirement(['p_studiox', 'p_yan', 'p_studiox'])
	assert.deepEqual(joint, {
		parties: ['p_studiox', 'p_yan'],
		quorum: 2,
		rule: 'every_obligor'
	})
	assert.equal(requirementSatisfied(joint, ['p_studiox']), false)
})

test('§26: recognition follows the beneficiary, and falls back to the covenant', () => {
	assert.deepEqual(
		recognitionRequirement({
			...REQUIREMENT_BASE,
			commitment: { beneficiary: { kind: 'parties', partyIds: ['p_acme'] } }
		}),
		{ parties: ['p_acme'], quorum: 1, rule: 'each_beneficiary' }
	)
	// Beneficiary = the collaboration itself: the covenant's operational rule.
	assert.deepEqual(
		recognitionRequirement({
			...REQUIREMENT_BASE,
			commitment: { beneficiary: { kind: 'collaboration' } }
		}),
		{ parties: ['p_yan'], quorum: 1, rule: 'steward_only' }
	)
	// …unless a party that carries the downside pulls it back to consent.
	assert.deepEqual(
		recognitionRequirement({
			...REQUIREMENT_BASE,
			commitment: { beneficiary: { kind: 'collaboration' } },
			escalatedByPartyIds: ['p_acme']
		}),
		{ parties: ['p_acme'], quorum: 1, rule: 'each_beneficiary' }
	)
})

test('§27: a milestone is the covenant’s, a completion is 2/3 + open obligors', () => {
	assert.equal(
		outcomeRequirement({ ...REQUIREMENT_BASE, scope: 'milestone', openObligorPartyIds: [] }).rule,
		'steward_only'
	)
	const final = outcomeRequirement({
		...REQUIREMENT_BASE,
		scope: 'final',
		openObligorPartyIds: ['p_acme']
	})
	assert.equal(final.rule, 'two_thirds_plus_open_obligors')
	// Every active party is eligible; only the open obligor is mandatory; the
	// quorum is the ⌈2/3⌉ threshold and NOT the roster length.
	assert.deepEqual([...final.parties].sort(), [...PARTIES].sort())
	assert.deepEqual(final.mandatory, ['p_acme'])
	assert.equal(final.quorum, 2)
	// Any two of the three satisfy it, as long as the open obligor is one of them.
	assert.equal(requirementSatisfied(final, ['p_acme', 'p_yan']), true)
	assert.equal(requirementSatisfied(final, ['p_acme', 'p_studiox']), true)
	// …and 2/3 without the obligor is not 2/3 of anything that counts.
	assert.equal(requirementSatisfied(final, ['p_yan', 'p_studiox']), false)
	assert.deepEqual(missingAuthorizations(final, ['p_yan', 'p_studiox']), ['p_acme'])
	// One signature is a signature, not a completion.
	assert.equal(requirementSatisfied(final, ['p_acme']), false)
})

test('a proposal is not yet a promise', () => {
	// The window between `commitment_proposed` and `commitment_accepted` is a
	// state of its own, and nothing reaches `recognized` from inside it.
	assert.doesNotThrow(() => assertCommitmentTransition('proposed', 'open'))
	assert.doesNotThrow(() => assertCommitmentTransition('proposed', 'released'))
	assert.throws(() => assertCommitmentTransition('proposed', 'fulfillment_claimed'), AlinkCoreError)
	assert.throws(() => assertCommitmentTransition('proposed', 'recognized'), AlinkCoreError)
	// And a date nobody has promised yet never reads as 「原定日期已过」.
	assert.equal(commitmentTiming({ state: 'proposed', dueAt: NOW - 5 }, NOW).kind, 'due')
})

// ---------------------------------------------------------------------------
// Party authorization (§18.2, INV-A2)

test('§18.2: a party can only be authorized by its own kind of proof', () => {
	const person = { principalType: 'person' }
	assert.doesNotThrow(() =>
		assertPartyAuthorizationShape(person, {
			principalType: 'person',
			confirmationRef: 'c1',
			confirmedBy: 'u_yan',
			at: NOW
		})
	)
	// INV-A2: an agent proof can never stand in for a person's confirmation.
	assert.throws(
		() =>
			assertPartyAuthorizationShape(person, {
				principalType: 'agent',
				capabilitySignatureRef: 's1',
				agentDid: 'did:agent:x',
				at: NOW
			}),
		/cannot be authorized by a agent proof/
	)
	assert.throws(
		() =>
			assertPartyAuthorizationShape(
				{ principalType: 'organization' },
				{ principalType: 'person', confirmationRef: 'c1', confirmedBy: 'u_lin', at: NOW }
			),
		/cannot be authorized by a person proof/
	)
})

test('拍板 6: outsiders see authorized / internal review / awaiting only', () => {
	const org = { principalType: 'organization' }
	assert.deepEqual(partyAuthorizationView(org, null, true), { state: 'internal_review' })
	assert.deepEqual(partyAuthorizationView(org, null, false), { state: 'awaiting' })
	assert.deepEqual(
		partyAuthorizationView(
			org,
			{ principalType: 'organization', organizationAuthorizationRef: 'oaz_1', at: NOW },
			true
		),
		{ state: 'authorized', at: NOW }
	)
	// A person party never shows 「内部审批中」 — there is no inside to review.
	assert.deepEqual(partyAuthorizationView({ principalType: 'person' }, null, true), {
		state: 'awaiting'
	})
})

// ---------------------------------------------------------------------------
// Commitments (§23–§26)

test('a claim is not a fulfilment', () => {
	assert.doesNotThrow(() => assertCommitmentTransition('fulfillment_claimed', 'recognized'))
	assert.doesNotThrow(() => assertCommitmentTransition('fulfillment_claimed', 'open'))
	// There is no path that reaches `recognized` without passing a claim or a
	// beneficiary's act — and none at all straight from `open`.
	assert.throws(() => assertCommitmentTransition('open', 'recognized'), AlinkCoreError)
	assert.deepEqual(COMMITMENT_TRANSITIONS.recognized, [])
})

test('§25: passing the due date is neutral, never a failure', () => {
	assert.deepEqual(commitmentTiming({ state: 'open' }, NOW), { kind: 'no_due_date' })
	assert.deepEqual(commitmentTiming({ state: 'open', dueAt: NOW + 5 }, NOW), {
		kind: 'due',
		dueAt: NOW + 5
	})
	const past = commitmentTiming({ state: 'open', dueAt: NOW - 5 }, NOW)
	assert.equal(past.kind, 'past_due')
	assert.equal(past.sinceMs, 5)
	// No state in this module is named for failure.
	for (const state of Object.keys(COMMITMENT_TRANSITIONS)) {
		assert.doesNotMatch(state, /lapsed|failed|broken|overdue|default/)
	}
	// A settled commitment stops telling a timing story at all.
	assert.equal(commitmentTiming({ state: 'recognized', dueAt: NOW - 5 }, NOW).kind, 'due')
	assert.equal(commitmentTiming({ state: 'released', dueAt: NOW - 5 }, NOW).kind, 'due')
})

const COMMITMENT = {
	obligorPartyIds: ['p_studiox'],
	beneficiary: { kind: 'parties', partyIds: ['p_yan'] }
}

test('§24: swapping the executor needs nobody‘s re-consent', () => {
	assert.deepEqual(reauthorizationRequiredFor(COMMITMENT, { kind: 'executor_reassigned' }), [])
})

test('§25: moving, releasing or narrowing needs obligor and beneficiary', () => {
	assert.deepEqual(reauthorizationRequiredFor(COMMITMENT, { kind: 'due_date_moved' }), [
		'p_studiox',
		'p_yan'
	])
	assert.deepEqual(reauthorizationRequiredFor(COMMITMENT, { kind: 'released' }), [
		'p_studiox',
		'p_yan'
	])
	assert.deepEqual(reauthorizationRequiredFor(COMMITMENT, { kind: 'success_condition_narrowed' }), [
		'p_studiox',
		'p_yan'
	])
})

test('§25: transferring the obligor needs old, new and beneficiary', () => {
	assert.deepEqual(
		reauthorizationRequiredFor(COMMITMENT, {
			kind: 'obligor_transferred',
			fromPartyId: 'p_studiox',
			toPartyId: 'p_acme'
		}),
		['p_acme', 'p_studiox', 'p_yan']
	)
})

test('§26: recognition follows the beneficiary, with an escalation door', () => {
	assert.deepEqual(recognizersFor(COMMITMENT, { activePartyIds: PARTIES }), {
		parties: ['p_yan'],
		rule: 'each_beneficiary'
	})
	const shared = { beneficiary: { kind: 'collaboration' } }
	assert.deepEqual(recognizersFor(shared, { activePartyIds: PARTIES }), {
		parties: [],
		rule: 'covenant_operational_rule'
	})
	assert.deepEqual(
		recognizersFor(shared, { activePartyIds: PARTIES, escalatedByPartyIds: ['p_acme'] }),
		{ parties: ['p_acme'], rule: 'each_beneficiary' }
	)
})

// ---------------------------------------------------------------------------
// Outcomes (§27, INV-C5)

test('§27: the final outcome needs 2/3 plus every open obligor', () => {
	const result = finalOutcomeRecognizers({
		activePartyIds: ['p_a', 'p_b', 'p_c'],
		openObligorPartyIds: ['p_c']
	})
	assert.equal(result.rule, 'two_thirds_plus_open_obligors')
	// ⚠️ 2/3 is a THRESHOLD over every active party, not a roster of two. Naming
	// ⌈2n/3⌉ parties would have to pick them by something the rule never
	// mentions, and would then refuse the third party's recognition outright.
	assert.deepEqual(result.parties, ['p_a', 'p_b', 'p_c'])
	assert.deepEqual(result.mandatory, ['p_c'])
	assert.equal(result.quorum, 2)
})

test('§27: a party outside the mandatory set still gets to recognize', () => {
	const result = finalOutcomeRecognizers({
		activePartyIds: ['p_a', 'p_b', 'p_c'],
		openObligorPartyIds: ['p_c']
	})
	// p_b owes nothing, so nobody needs p_b specifically — but p_b is eligible,
	// and p_b's yes is what carries the count over the threshold.
	assert.ok(result.parties.includes('p_b'))
	assert.deepEqual(missingAuthorizations(result, ['p_b', 'p_c']), [])
	assert.equal(requirementSatisfied({ ...result }, ['p_b', 'p_c']), true)
	assert.equal(requirementSatisfied({ ...result }, ['p_a', 'p_b']), false)
})

test('§27: an open obligor is required even beyond the 2/3 count', () => {
	const result = finalOutcomeRecognizers({
		activePartyIds: ['p_a', 'p_b', 'p_c', 'p_d', 'p_e', 'p_f'],
		openObligorPartyIds: ['p_f']
	})
	assert.deepEqual(result.mandatory, ['p_f'])
	assert.equal(result.quorum, 4)
	// Four of six is the threshold — and it is still not enough without p_f.
	assert.equal(requirementSatisfied(result, ['p_a', 'p_b', 'p_c', 'p_d']), false)
	assert.equal(requirementSatisfied(result, ['p_a', 'p_b', 'p_c', 'p_f']), true)
})

test('INV-C5: publishing needs the party AND the named person', () => {
	const missing = publicationConsentMissing({
		namedPartyIds: ['p_studiox', 'p_yan'],
		namedPersonIds: ['u_lin'],
		partyOptIns: ['p_studiox'],
		personOptIns: []
	})
	assert.deepEqual(missing.parties, ['p_yan'])
	assert.deepEqual(missing.persons, ['u_lin'])
	// The organization saying yes does not carry its member.
	const orgOnly = publicationConsentMissing({
		namedPartyIds: ['p_studiox'],
		namedPersonIds: ['u_lin'],
		partyOptIns: ['p_studiox'],
		personOptIns: []
	})
	assert.deepEqual(orgOnly.parties, [])
	assert.deepEqual(orgOnly.persons, ['u_lin'])
})

// ---------------------------------------------------------------------------
// Ledger (§21, INV-A1)

test('§21.2: the ledger has no general-purpose note event', () => {
	for (const forbidden of ['note', 'message', 'ai_update', 'comment', 'chat']) {
		assert.equal(LEDGER_EVENT_KINDS.includes(forbidden), false)
	}
	assert.equal(new Set(LEDGER_EVENT_KINDS).size, LEDGER_EVENT_KINDS.length)
	assert.equal(isLedgerEventKind('commitment_accepted'), true)
	assert.equal(isLedgerEventKind('note'), false)
})

test('every party-binding kind is a real ledger kind', () => {
	for (const kind of PARTY_BINDING_EVENT_KINDS) {
		assert.ok(LEDGER_EVENT_KINDS.includes(kind), kind)
	}
})

const AUTHORSHIP = { generatedBy: 'u_lin', actsForPartyId: 'p_studiox' }

test('INV-A1: a ledger event needs both authorship and authority', () => {
	assert.throws(
		() => assertLedgerEventAuthority('context_shared', AUTHORSHIP, {}),
		/needs an authority/
	)
	assert.throws(
		() =>
			assertLedgerEventAuthority(
				'context_shared',
				{ generatedBy: '', actsForPartyId: 'p_studiox' },
				{ seatGrantRef: 'g1' }
			),
		/needs an authorship/
	)
	assert.doesNotThrow(() =>
		assertLedgerEventAuthority('context_shared', AUTHORSHIP, { seatGrantRef: 'g1' })
	)
})

test('INV-C2: a party-binding write cannot rest on a seat grant alone', () => {
	assert.throws(
		() => assertLedgerEventAuthority('commitment_accepted', AUTHORSHIP, { seatGrantRef: 'g1' }),
		/cannot rest on a seat grant alone/
	)
	assert.doesNotThrow(() =>
		assertLedgerEventAuthority('commitment_accepted', AUTHORSHIP, {
			seatGrantRef: 'g1',
			organizationAuthorizationRef: 'oaz_1'
		})
	)
	assert.doesNotThrow(() =>
		assertLedgerEventAuthority(
			'outcome_recognized',
			{ ...AUTHORSHIP, viaAgent: 'did:agent:x' },
			{ personConfirmationRef: 'c1' }
		)
	)
})

// ---------------------------------------------------------------------------
// Capsules (§22.1, INV-K3)

const CAPSULE = {
	readers: [
		{ kind: 'party', ref: 'p_acme', usage: ['human_read'] },
		{ kind: 'agent', ref: 'did:agent:x', usage: ['agent_read'] }
	],
	startsAt: NOW - 1
}

test('§22.1: a party reader does not make its members readers', () => {
	assert.equal(
		capsuleReadableBy(CAPSULE, { kind: 'party', ref: 'p_acme', usage: 'human_read' }, NOW),
		true
	)
	// A participant of that party is NOT covered — the organization must
	// distribute inward, and nothing here walks party → participants.
	assert.equal(
		capsuleReadableBy(CAPSULE, { kind: 'participant', ref: 'cpt_1', usage: 'human_read' }, NOW),
		false
	)
	// Usage is part of the grant, not a formality.
	assert.equal(
		capsuleReadableBy(CAPSULE, { kind: 'party', ref: 'p_acme', usage: 'agent_read' }, NOW),
		false
	)
	assert.equal(
		capsuleReadableBy(CAPSULE, { kind: 'agent', ref: 'did:agent:x', usage: 'agent_read' }, NOW),
		true
	)
})

test('capsule windows and revocation close the door', () => {
	const reader = { kind: 'party', ref: 'p_acme', usage: 'human_read' }
	assert.equal(capsuleReadableBy({ ...CAPSULE, revokedAt: NOW }, reader, NOW), false)
	assert.equal(capsuleReadableBy({ ...CAPSULE, expiresAt: NOW }, reader, NOW), false)
	assert.equal(capsuleReadableBy({ ...CAPSULE, startsAt: NOW + 1 }, reader, NOW), false)
})

// ---------------------------------------------------------------------------
// §52 — the tools that must never exist

test('§52: no deliberately-absent collaboration tool is in the catalog', () => {
	for (const action of DELIBERATELY_ABSENT_COLLAB_TOOLS) {
		assert.equal(
			Object.hasOwn(MCP_TOOL_DEFINITIONS, action),
			false,
			`${action} must never exist as a tool`
		)
		const wire = action.replaceAll('.', '_')
		for (const known of Object.keys(MCP_TOOL_DEFINITIONS)) {
			assert.notEqual(known.replaceAll('.', '_'), wire)
		}
	}
})
