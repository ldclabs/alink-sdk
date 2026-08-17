import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
	APPROVAL_DEFAULT_TTL_MS,
	AlinkCoreError,
	DEFAULT_ORG_ROLES,
	DELIBERATELY_ABSENT_ORG_TOOLS,
	EXTERNAL_COMMITMENT_ACTIONS,
	MEMBERSHIP_TRANSITIONS,
	MEMBER_PRINCIPAL_TYPES,
	MCP_TOOL_DEFINITIONS,
	ORGANIZATION_TRANSITIONS,
	ORG_CAPABILITIES,
	PROTECTED_ACTIONS,
	ROLE_INELIGIBLE_CAPABILITIES,
	UNWAIVABLE_MEMBER_RIGHTS,
	actingContextChanged,
	actsForOrganization,
	assertAuthorizationBinding,
	assertMembershipAcceptance,
	assertMembershipTransition,
	assertOrganizationTransition,
	assertValidControlPolicy,
	computeActionDigest,
	controlSatisfied,
	countsTowardActiveMembers,
	defaultCharter,
	defaultControlPolicy,
	effectiveCapabilities,
	evaluateApproval,
	grantCovers,
	grantsForRoleAssignment,
	hasCapability,
	isGrantLive,
	isMemberPrincipalType,
	isMembershipLive,
	isOrgPostPublic,
	isProtectedAction,
	isValidOrganizationId,
	organizationAuthorizationMaterial,
	organizationIdFromXid,
	organizationXidOf,
	resolveApprovalPolicy,
	frontDeskStands,
	memberLinkable,
	shelfPostOf
} from '../src/index.js'

const NOW = 1_760_000_000_000
const XID = 'cv0abcdefghijklmnopq'.slice(0, 20)

// ---------------------------------------------------------------------------
// Identity

test('organization ids are prefixed xids and round-trip', () => {
	const id = organizationIdFromXid(XID)
	assert.equal(id, `org_${XID}`)
	assert.ok(isValidOrganizationId(id))
	assert.equal(organizationXidOf(id), XID)
})

test('an organization id is never confused with a person xid', () => {
	// The whole point of the prefix: the bare xid must NOT pass the org check,
	// and the prefixed id must NOT pass a bare-xid check anywhere upstream.
	assert.equal(isValidOrganizationId(XID), false)
	assert.equal(isValidOrganizationId('org_not-an-xid'), false)
	assert.throws(() => organizationIdFromXid('nope'), /Invalid xid/)
	assert.throws(() => organizationXidOf(XID), /Invalid organization id/)
})

// ---------------------------------------------------------------------------
// State machines

test('organization lifecycle transitions', () => {
	assert.doesNotThrow(() => assertOrganizationTransition('draft', 'active'))
	assert.doesNotThrow(() => assertOrganizationTransition('suspended', 'active'))
	assert.throws(() => assertOrganizationTransition('dissolved', 'active'), AlinkCoreError)
	assert.throws(() => assertOrganizationTransition('draft', 'suspended'), AlinkCoreError)
	// Every state reachable, and only `dissolved` terminal.
	assert.deepEqual(ORGANIZATION_TRANSITIONS.dissolved, [])
})

test('membership lifecycle: a declined invitation ends, it is never revoked', () => {
	assert.doesNotThrow(() => assertMembershipTransition('invited', 'ended'))
	assert.doesNotThrow(() => assertMembershipTransition('active', 'ending'))
	assert.throws(() => assertMembershipTransition('ended', 'active'), AlinkCoreError)
	assert.throws(() => assertMembershipTransition('revoked', 'active'), AlinkCoreError)
	assert.deepEqual(MEMBERSHIP_TRANSITIONS.ended, [])
	assert.deepEqual(MEMBERSHIP_TRANSITIONS.revoked, [])
})

// ---------------------------------------------------------------------------
// INV-O2 — no silent membership

test('only the invited principal can accept, and only from invited', () => {
	const membership = { state: 'invited', member: { principalId: 'u_yan', principalType: 'person' } }
	assert.doesNotThrow(() => assertMembershipAcceptance(membership, 'u_yan'))
	assert.throws(() => assertMembershipAcceptance(membership, 'u_lin'), /only be accepted by/)
	assert.throws(
		() => assertMembershipAcceptance({ ...membership, state: 'active' }, 'u_yan'),
		/no longer open/
	)
})

test('membership liveness respects window and state', () => {
	const base = { state: 'active', startsAt: NOW - 1000 }
	assert.equal(isMembershipLive(base, NOW), true)
	assert.equal(isMembershipLive({ ...base, state: 'suspended' }, NOW), false)
	assert.equal(isMembershipLive({ ...base, startsAt: NOW + 1000 }, NOW), false)
	assert.equal(isMembershipLive({ ...base, expiresAt: NOW - 1 }, NOW), false)
})

test('拍板 2 seat counting: invited and terminal states are free', () => {
	assert.equal(countsTowardActiveMembers('active'), true)
	assert.equal(countsTowardActiveMembers('suspended'), true)
	assert.equal(countsTowardActiveMembers('invited'), false)
	assert.equal(countsTowardActiveMembers('ending'), false)
	assert.equal(countsTowardActiveMembers('ended'), false)
	assert.equal(countsTowardActiveMembers('revoked'), false)
})

test('拍板 4: person, agent and organization may all be members', () => {
	assert.deepEqual([...MEMBER_PRINCIPAL_TYPES], ['person', 'agent', 'organization'])
	assert.equal(isMemberPrincipalType('agent'), true)
	assert.equal(isMemberPrincipalType('team'), false)
	assert.equal(isMemberPrincipalType('project'), false)
})

// ---------------------------------------------------------------------------
// INV-O3 — roles never grant

test('INV-O3: hasCapability answers from grants alone', () => {
	const grant = {
		id: 'ocg_1',
		organizationId: 'org_x',
		subject: 'u_lin',
		capability: 'org:commit:propose',
		grantedBy: 'u_yan',
		startsAt: NOW - 1,
		revocable: true
	}
	assert.equal(hasCapability([grant], 'org:commit:propose', { subject: 'u_lin', now: NOW }), true)
	// A different subject, an unrelated capability and an expired grant all say no.
	assert.equal(hasCapability([grant], 'org:commit:propose', { subject: 'u_mira', now: NOW }), false)
	assert.equal(hasCapability([grant], 'org:commit:approve', { subject: 'u_lin', now: NOW }), false)
	assert.equal(
		hasCapability([{ ...grant, expiresAt: NOW - 1 }], 'org:commit:propose', {
			subject: 'u_lin',
			now: NOW
		}),
		false
	)
	// The invariant's structural half: the signature has no way to pass a role.
	assert.equal(hasCapability.length, 3)
})

test('INV-O3: a role template can never carry org:control:admin', () => {
	const rogue = { defaultCapabilities: ['org:profile:read', 'org:control:admin'] }
	assert.deepEqual(grantsForRoleAssignment(rogue), ['org:profile:read'])
	for (const role of DEFAULT_ORG_ROLES) {
		for (const capability of ROLE_INELIGIBLE_CAPABILITIES) {
			assert.equal(
				role.defaultCapabilities.includes(capability),
				false,
				`${role.name} must not carry ${capability}`
			)
		}
	}
})

test('§7.3: the default Member role confers almost nothing', () => {
	const member = DEFAULT_ORG_ROLES.find((role) => role.name === 'Member')
	assert.ok(member)
	for (const forbidden of [
		'org:member:invite',
		'org:commit:propose',
		'org:collaboration:represent',
		'org:role:assign',
		'org:audit:read'
	]) {
		assert.equal(member.defaultCapabilities.includes(forbidden), false)
	}
})

test('grant scoping: a scoped grant never answers an unscoped question', () => {
	const scoped = { capability: 'org:collaboration:represent', resourceScope: ['clb_a'] }
	assert.equal(grantCovers(scoped, 'org:collaboration:represent', 'clb_a'), true)
	assert.equal(grantCovers(scoped, 'org:collaboration:represent', 'clb_b'), false)
	assert.equal(grantCovers(scoped, 'org:collaboration:represent'), false)
	const unscoped = { capability: 'org:collaboration:represent' }
	assert.equal(grantCovers(unscoped, 'org:collaboration:represent'), true)
	assert.equal(grantCovers(unscoped, 'org:collaboration:represent', 'clb_a'), true)
})

test('grant liveness handles revocation, start and expiry', () => {
	assert.equal(isGrantLive({ startsAt: NOW - 1 }, NOW), true)
	assert.equal(isGrantLive({ startsAt: NOW + 1 }, NOW), false)
	assert.equal(isGrantLive({ startsAt: 0, expiresAt: NOW }, NOW), false)
	assert.equal(isGrantLive({ startsAt: 0, revokedAt: NOW }, NOW), false)
})

test('effectiveCapabilities returns live grants in canonical order', () => {
	const grants = [
		{ subject: 'u_lin', capability: 'org:audit:read', startsAt: 0, revocable: true },
		{ subject: 'u_lin', capability: 'org:profile:read', startsAt: 0, revocable: true },
		{
			subject: 'u_lin',
			capability: 'org:commit:approve',
			startsAt: 0,
			revokedAt: 1,
			revocable: true
		},
		{ subject: 'u_mira', capability: 'org:control:admin', startsAt: 0, revocable: true }
	]
	assert.deepEqual(effectiveCapabilities(grants, { subject: 'u_lin', now: NOW }), [
		'org:profile:read',
		'org:audit:read'
	])
	assert.deepEqual(
		effectiveCapabilities(grants, { subject: 'u_lin', now: NOW }).indexOf('org:control:admin'),
		-1
	)
})

test('the capability vocabulary matches §8.1 exactly', () => {
	assert.equal(ORG_CAPABILITIES.length, 16)
	assert.equal(new Set(ORG_CAPABILITIES).size, 16)
	for (const capability of ORG_CAPABILITIES) {
		assert.match(capability, /^org:[a-z_]+:[a-z_]+$/)
	}
})

// ---------------------------------------------------------------------------
// Control policy (拍板 1)

test('拍板 1: the default control policy is 1-of-1', () => {
	const policy = defaultControlPolicy('u_yan')
	assert.deepEqual(policy.controllers, ['u_yan'])
	assert.equal(policy.threshold, 1)
	assert.equal(policy.requireStepUp, true)
	assert.deepEqual([...policy.protectedActions], [...PROTECTED_ACTIONS])
	assert.doesNotThrow(() => assertValidControlPolicy(policy))
})

test('control policy validation rejects impossible thresholds', () => {
	assert.throws(
		() => assertValidControlPolicy({ ...defaultControlPolicy('u_yan'), controllers: [] }),
		/at least one controller/
	)
	assert.throws(
		() =>
			assertValidControlPolicy({
				...defaultControlPolicy('u_yan'),
				controllers: ['a', 'b'],
				threshold: 3
			}),
		/between 1 and/
	)
	assert.throws(
		() =>
			assertValidControlPolicy({
				...defaultControlPolicy('u_yan'),
				controllers: ['a', 'a'],
				threshold: 1
			}),
		/distinct/
	)
})

test('controlSatisfied counts distinct controllers only', () => {
	const policy = { controllers: ['a', 'b', 'c'], threshold: 2 }
	assert.equal(controlSatisfied(policy, ['a', 'a']), false)
	assert.equal(controlSatisfied(policy, ['a', 'z']), false)
	assert.equal(controlSatisfied(policy, ['a', 'b']), true)
})

// ---------------------------------------------------------------------------
// Charter (拍板 5)

test('拍板 5: an unconfigured charter commits externally by controller', () => {
	const charter = defaultCharter({
		purpose: 'Design studio',
		founderPrincipalId: 'u_yan',
		now: NOW
	})
	assert.equal(charter.externalCommitmentPolicy, 'controller')
	assert.equal(charter.admissionPolicy, 'invite_only')
	assert.equal(charter.publicDisclosurePolicy, 'opt_in')
	assert.equal(charter.version, 1)
	assert.deepEqual(charter.ratifiedBy, ['u_yan'])
})

test('§6.1 unwaivable rights are enumerated data, not prose', () => {
	assert.equal(UNWAIVABLE_MEMBER_RIGHTS.length, 8)
	assert.ok(UNWAIVABLE_MEMBER_RIGHTS.includes('no_silent_membership'))
	assert.ok(UNWAIVABLE_MEMBER_RIGHTS.includes('org_commitment_never_becomes_personal'))
})

// ---------------------------------------------------------------------------
// Approval resolution (§10.1)

const CONTROL = { threshold: 2 }
const LOOSE_POLICY = {
	id: 'oap_1',
	organizationId: 'org_x',
	actionType: 'org.commitment.authorize',
	eligibleApprovers: ['u_lin'],
	threshold: 1,
	separationOfDuties: false,
	expiresAfterMs: 3600_000,
	version: 3
}

test('§10.1: a strict charter ignores a loose external-commitment policy', () => {
	const resolved = resolveApprovalPolicy({
		organizationId: 'org_x',
		actionType: 'org.commitment.authorize',
		charter: { externalCommitmentPolicy: 'controller' },
		controlPolicy: CONTROL,
		policies: [LOOSE_POLICY]
	})
	assert.equal(resolved.eligibleApprovers, 'controllers')
	assert.equal(resolved.threshold, 2)
})

test('§10.1: the loose policy applies once the charter says so out loud', () => {
	const resolved = resolveApprovalPolicy({
		organizationId: 'org_x',
		actionType: 'org.commitment.authorize',
		charter: { externalCommitmentPolicy: 'delegated' },
		controlPolicy: CONTROL,
		policies: [LOOSE_POLICY]
	})
	assert.equal(resolved.id, 'oap_1')
	assert.deepEqual(resolved.eligibleApprovers, ['u_lin'])
})

test('§9.1: a protected action is the controllers‘, whatever any policy says', () => {
	for (const actionType of PROTECTED_ACTIONS) {
		const resolved = resolveApprovalPolicy({
			organizationId: 'org_x',
			actionType,
			charter: { externalCommitmentPolicy: 'delegated' },
			controlPolicy: CONTROL,
			policies: [{ ...LOOSE_POLICY, actionType, eligibleApprovers: ['u_lin'], threshold: 1 }]
		})
		assert.equal(resolved.eligibleApprovers, 'controllers', actionType)
		assert.equal(resolved.threshold, 2, actionType)
	}
	assert.equal(isProtectedAction('org.dissolve'), true)
	assert.equal(isProtectedAction('org.profile.update'), false)
})

test('an unknown action with no policy falls to controllers, never to open', () => {
	const resolved = resolveApprovalPolicy({
		organizationId: 'org_x',
		actionType: 'org.something.new',
		charter: { externalCommitmentPolicy: 'delegated' },
		controlPolicy: CONTROL,
		policies: []
	})
	assert.equal(resolved.eligibleApprovers, 'controllers')
	assert.equal(resolved.expiresAfterMs, APPROVAL_DEFAULT_TTL_MS)
})

test('every external-commitment action is a real domain action name', () => {
	for (const action of EXTERNAL_COMMITMENT_ACTIONS) {
		assert.match(action, /^org\.[a-z_]+\.[a-z_]+$/)
	}
})

// ---------------------------------------------------------------------------
// Approval evaluation

const INSTANCE = {
	votes: [],
	proposedBy: 'u_yan',
	expiresAt: NOW + 3600_000,
	state: 'pending'
}

test('approval reaches the threshold on distinct eligible approvals', () => {
	const result = evaluateApproval({
		policy: { eligibleApprovers: 'controllers', threshold: 2, separationOfDuties: false },
		controllers: ['u_yan', 'u_lin', 'u_mira'],
		instance: {
			...INSTANCE,
			votes: [
				{ approverId: 'u_yan', decision: 'approve', at: NOW },
				{ approverId: 'u_yan', decision: 'approve', at: NOW },
				{ approverId: 'u_lin', decision: 'approve', at: NOW }
			]
		},
		now: NOW
	})
	assert.equal(result.state, 'satisfied')
	assert.deepEqual([...result.countedBy], ['u_yan', 'u_lin'])
})

test('an ineligible approval never counts', () => {
	const result = evaluateApproval({
		policy: { eligibleApprovers: ['u_lin'], threshold: 1, separationOfDuties: false },
		controllers: ['u_yan'],
		instance: { ...INSTANCE, votes: [{ approverId: 'u_yan', decision: 'approve', at: NOW }] },
		now: NOW
	})
	assert.equal(result.state, 'pending')
	assert.equal(result.remaining, 1)
})

test('separation of duties drops the proposer’s own approval', () => {
	const result = evaluateApproval({
		policy: { eligibleApprovers: 'controllers', threshold: 1, separationOfDuties: true },
		controllers: ['u_yan', 'u_lin'],
		instance: { ...INSTANCE, votes: [{ approverId: 'u_yan', decision: 'approve', at: NOW }] },
		now: NOW
	})
	assert.equal(result.state, 'pending')
})

test('one eligible rejection ends it — a majority cannot carry', () => {
	const result = evaluateApproval({
		policy: { eligibleApprovers: 'controllers', threshold: 2, separationOfDuties: false },
		controllers: ['u_yan', 'u_lin', 'u_mira'],
		instance: {
			...INSTANCE,
			votes: [
				{ approverId: 'u_yan', decision: 'approve', at: NOW },
				{ approverId: 'u_mira', decision: 'reject', at: NOW },
				{ approverId: 'u_lin', decision: 'approve', at: NOW }
			]
		},
		now: NOW
	})
	assert.equal(result.state, 'rejected')
})

test('a threshold met before the deadline survives a late read (TD-6)', () => {
	const result = evaluateApproval({
		policy: { eligibleApprovers: 'controllers', threshold: 1, separationOfDuties: false },
		controllers: ['u_lin'],
		instance: {
			...INSTANCE,
			expiresAt: NOW - 1,
			votes: [{ approverId: 'u_lin', decision: 'approve', at: NOW - 10_000 }]
		},
		now: NOW
	})
	assert.equal(result.state, 'satisfied')
})

test('an unmet approval past its deadline expires', () => {
	const result = evaluateApproval({
		policy: { eligibleApprovers: 'controllers', threshold: 2, separationOfDuties: false },
		controllers: ['u_yan', 'u_lin'],
		instance: {
			...INSTANCE,
			expiresAt: NOW - 1,
			votes: [{ approverId: 'u_yan', decision: 'approve', at: NOW - 10_000 }]
		},
		now: NOW
	})
	assert.equal(result.state, 'expired')
	assert.equal(result.remaining, 1)
})

// ---------------------------------------------------------------------------
// OrganizationAuthorization (TD-4, §44 内部政策伪造)

const ACTION = {
	organizationId: 'org_x',
	actionType: 'org.commitment.authorize',
	target: 'cmt_88f2',
	params: { text: 'deliver by Aug 15', dueAt: 1_763_000_000_000 }
}

test('the action digest binds every material parameter', async () => {
	const base = await computeActionDigest(ACTION)
	assert.match(base, /^[A-Za-z0-9_-]{43}$/)
	// Key order must not matter; a changed value must.
	const reordered = await computeActionDigest({
		...ACTION,
		params: { dueAt: ACTION.params.dueAt, text: ACTION.params.text }
	})
	assert.equal(reordered, base)
	for (const mutated of [
		{ ...ACTION, target: 'cmt_other' },
		{ ...ACTION, actionType: 'org.outcome.recognize' },
		{ ...ACTION, organizationId: 'org_y' },
		{ ...ACTION, params: { ...ACTION.params, dueAt: 1 } }
	]) {
		assert.notEqual(await computeActionDigest(mutated), base)
	}
})

const AUTHORIZATION = {
	id: 'oaz_1',
	organizationId: 'org_x',
	actionDigest: 'DIGEST',
	policyVersion: 3,
	approvalRefs: ['oapr_2', 'oapr_1'],
	validFrom: NOW - 1000,
	expiresAt: NOW + 1000,
	nonce: 'n1',
	signerDid: 'did:agent:abc'
}

test('the signed material is order-independent over approvalRefs', () => {
	const a = organizationAuthorizationMaterial(AUTHORIZATION)
	const b = organizationAuthorizationMaterial({
		...AUTHORIZATION,
		approvalRefs: ['oapr_1', 'oapr_2']
	})
	assert.equal(a, b)
	// …but not over anything that changes meaning.
	assert.notEqual(a, organizationAuthorizationMaterial({ ...AUTHORIZATION, nonce: 'n2' }))
	assert.notEqual(a, organizationAuthorizationMaterial({ ...AUTHORIZATION, policyVersion: 4 }))
})

test('拍板 6: the authorization carries no approver identities', () => {
	const material = organizationAuthorizationMaterial(AUTHORIZATION)
	assert.equal(material.includes('u_yan'), false)
	assert.equal(material.includes('threshold'), false)
	assert.equal(material.includes('eligibleApprovers'), false)
})

test('binding check: organization, action, window and replay', () => {
	const expected = {
		organizationId: 'org_x',
		actionDigest: 'DIGEST',
		now: NOW,
		seenNonces: new Set()
	}
	assert.doesNotThrow(() => assertAuthorizationBinding(AUTHORIZATION, expected))
	assert.throws(
		() => assertAuthorizationBinding(AUTHORIZATION, { ...expected, organizationId: 'org_y' }),
		/another organization/
	)
	assert.throws(
		() => assertAuthorizationBinding(AUTHORIZATION, { ...expected, actionDigest: 'OTHER' }),
		/different action/
	)
	assert.throws(
		() => assertAuthorizationBinding(AUTHORIZATION, { ...expected, now: NOW - 5000 }),
		/not valid yet/
	)
	assert.throws(
		() => assertAuthorizationBinding(AUTHORIZATION, { ...expected, now: NOW + 5000 }),
		/expired/
	)
	assert.throws(
		() =>
			assertAuthorizationBinding(AUTHORIZATION, {
				...expected,
				seenNonces: new Set(['n1'])
			}),
		/already used/
	)
})

// ---------------------------------------------------------------------------
// Acting context (§39)

test('§39: switching hats is a change, even for the same person', () => {
	const self = { kind: 'self', actorPrincipalId: 'u_yan' }
	const forX = { kind: 'organization', actorPrincipalId: 'u_yan', organizationId: 'org_x' }
	const forY = { kind: 'organization', actorPrincipalId: 'u_yan', organizationId: 'org_y' }
	assert.equal(actingContextChanged(self, self), false)
	assert.equal(actingContextChanged(forX, forX), false)
	assert.equal(actingContextChanged(self, forX), true)
	assert.equal(actingContextChanged(forX, self), true)
	assert.equal(actingContextChanged(forX, forY), true)
	assert.equal(actsForOrganization(self), null)
	assert.equal(actsForOrganization(forX), 'org_x')
})

// ---------------------------------------------------------------------------
// §51 — the tools that must never exist

test('§51: no deliberately-absent organization tool is in the catalog', () => {
	for (const action of DELIBERATELY_ABSENT_ORG_TOOLS) {
		assert.equal(
			Object.hasOwn(MCP_TOOL_DEFINITIONS, action),
			false,
			`${action} must never exist as a tool`
		)
		// Also guard the wire name, which is what a client actually sees.
		const wire = action.replaceAll('.', '_')
		for (const known of Object.keys(MCP_TOOL_DEFINITIONS)) {
			assert.notEqual(known.replaceAll('.', '_'), wire)
		}
	}
})

// ---------------------------------------------------------------------------
// §11 — the organization's door, after 拍板 14/15
//
// ⚠️ Four tests were deleted here, all of them about `resolveRepresentative`:
// which AI stood this door, how the disclosure followed the resolved shape
// rather than the configuration, and how a session froze the promise it was
// opened under. There is no AI at an organization's door any more (§11.1), so
// none of those questions has a subject. What replaces them is smaller and
// blunter: who a stranger is pointed AT, and whether that pointer is allowed.

test('§11.3: whether a name is a link is that person’s own decision', () => {
	assert.equal(memberLinkable('public'), true)
	// ⚠️⚠️ `link_only` is a REFUSAL, and it is the one worth stating: that person
	// chose 「只给我把链接发出去的人看」, and putting the link on an organization's
	// public page is precisely handing it to everyone. Agreeing to be NAMED is a
	// different consent from being a place strangers arrive at.
	assert.equal(memberLinkable('link_only'), false)
	assert.equal(memberLinkable('private'), false)
	// An account that never published a card never made one public.
	assert.equal(memberLinkable(null), false)
	assert.equal(memberLinkable(undefined), false)
	assert.equal(memberLinkable('anything else'), false)
})

test('§11.2: a front desk needs all four legs, and loses the seat when any goes', () => {
	const frontDesk = { memberId: 'usr_x', offeredBy: 'usr_y', offeredAt: 1, acceptedAt: 2 }
	const stands = (over = {}) =>
		frontDeskStands({
			frontDesk,
			memberActive: true,
			publiclyListed: true,
			cardPublic: true,
			...over
		})
	assert.equal(stands(), true)
	// Each leg alone empties the seat — and emptying it is a silent fallback to
	// the plain roster, never a broken page and never a stale name that goes on
	// collecting letters. 「加一条只有 X 能做的规则时，先问 X 走了会怎样」.
	assert.equal(stands({ frontDesk: null }), false)
	assert.equal(stands({ memberActive: false }), false)
	assert.equal(stands({ publiclyListed: false }), false)
	assert.equal(stands({ cardPublic: false }), false)
})

test('§11.5: a post is public only while it is active and unexpired', () => {
	const now = 1_000
	assert.equal(isOrgPostPublic({ status: 'active', expiresAt: null }, now), true)
	assert.equal(isOrgPostPublic({ status: 'active', expiresAt: now + 1 }, now), true)
	// Read-time expiry (TD-6 零定时任务): nothing had to run for this to be false.
	assert.equal(isOrgPostPublic({ status: 'active', expiresAt: now }, now), false)
	assert.equal(isOrgPostPublic({ status: 'paused', expiresAt: null }, now), false)
	assert.equal(isOrgPostPublic({ status: 'completed', expiresAt: null }, now), false)
})

test('§11.5: the shelf row carries the form, not just the title', () => {
	// The row renders as 「在找：{title}」 for a seeking post and bare for a
	// notice. A title with no form puts 「在找：我们搬了办公室」 — a sentence the
	// organization never said — on every shelf that has it.
	assert.deepEqual(shelfPostOf([]), null)
	assert.deepEqual(
		shelfPostOf([
			{ form: 'seeking', title: 'Looking for a translator', updatedAt: 10 },
			{ form: 'notice', title: 'We moved', updatedAt: 20 }
		]),
		{ title: 'We moved', form: 'notice' }
	)
	assert.deepEqual(
		shelfPostOf([
			{ form: 'notice', title: 'We moved', updatedAt: 10 },
			{ form: 'seeking', title: 'Hiring an editor', updatedAt: 20 }
		]),
		{ title: 'Hiring an editor', form: 'seeking' }
	)
	// ⚠️ `updatedAt`, not `createdAt`: editing an older post is the organization
	// saying that thing again, and the shelf line is what it is CURRENTLY saying.
	// This is the rule production runs — `latestPublicPost` calls this function
	// rather than carrying a second copy of it.
	assert.deepEqual(
		shelfPostOf([
			{ form: 'notice', title: 'We moved', updatedAt: 20 },
			{ form: 'seeking', title: 'Hiring an editor (edited)', updatedAt: 30 }
		]),
		{ title: 'Hiring an editor (edited)', form: 'seeking' }
	)
})
