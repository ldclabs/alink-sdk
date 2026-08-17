/**
 * Organization — 组织主体 (docs/alink-collaboration.md Part B, devplan WP-K1).
 *
 * An Organization is a Principal, not an account: it has no login, no session
 * and no password (devplan TD-1). Every organization action is performed by a
 * member signed in AS THEMSELVES who is acting FOR the organization, and the
 * write carries that `actsFor` binding. That single decision is what keeps the
 * account-security surface unchanged by this entire model — and it is also why
 * the most dangerous failure here is not a stolen credential but a confused
 * one: a person who believed they were speaking for themselves and signed for
 * the organization instead (§44 身份混淆, Identity Confusion Incidents 目标 0).
 *
 * Two rules in this file carry most of the model's weight:
 *
 * ① **Roles never grant** (INV-O3). `OrgRole.defaultCapabilities` is a template
 *   read at ASSIGNMENT time to materialize explicit `OrgCapabilityGrant` rows;
 *   `hasCapability` cannot see roles at all — it takes grants and nothing else.
 *   A label in the UI reading 「设计负责人」 is a word, not a key.
 *
 * ② **Default from strict** (§10.1, 拍板 5). An organization that has configured
 *   nothing commits externally only with controller confirmation. Every looser
 *   rule in §10's example table is something a charter said out loud, and the
 *   saying of it is on the ledger.
 *
 * Everything here is pure: no bindings, no crypto keys, no storage. Signing and
 * key custody live in the service layer; this module decides WHETHER something
 * is authorized and WHAT an authorization must contain.
 */
import { AlinkCoreError } from './errors.js'
import { canonicalJson } from './idempotency.js'
import type { PrincipalType } from './protocols.js'

// ---------------------------------------------------------------------------
// Lifecycle

/** §5. `draft` is the pre-activation window; `dissolved` is terminal. */
export type OrganizationState = 'draft' | 'active' | 'suspended' | 'dissolving' | 'dissolved'

export const ORGANIZATION_TRANSITIONS: Record<OrganizationState, readonly OrganizationState[]> = {
	draft: ['active', 'dissolved'],
	active: ['suspended', 'dissolving'],
	// Suspension is a safety state, never a one-way door: an organization that
	// proves control again comes back. Dissolution from suspended exists so a
	// compromised organization can still be wound down by its controllers.
	suspended: ['active', 'dissolving'],
	dissolving: ['dissolved', 'active'],
	dissolved: []
}

/** §6 organizationType. Presentation and defaults only — never a permission. */
export const ORGANIZATION_TYPES = [
	'company',
	'studio',
	'lab',
	'community',
	'nonprofit',
	'dao',
	'club',
	'other'
] as const

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number]

export function isOrganizationType(value: unknown): value is OrganizationType {
	return typeof value === 'string' && (ORGANIZATION_TYPES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Membership

/** §7.1 state machine. */
export type MembershipState = 'invited' | 'active' | 'suspended' | 'ending' | 'ended' | 'revoked'

export const MEMBERSHIP_TRANSITIONS: Record<MembershipState, readonly MembershipState[]> = {
	// An invitation that is declined dies as `ended` — never as `revoked`, which
	// is the security vocabulary and would libel someone who simply said no.
	invited: ['active', 'ended', 'revoked'],
	active: ['suspended', 'ending', 'ended', 'revoked'],
	suspended: ['active', 'ending', 'ended', 'revoked'],
	ending: ['ended', 'revoked'],
	ended: [],
	revoked: []
}

/** §7.1 publicVisibility. `public_opt_in` requires BOTH sides (§44 公开冒名). */
export type MembershipVisibility = 'private' | 'organization_only' | 'public_opt_in'

/**
 * §3.3 / 拍板 4: person, agent and organization may all hold a Membership from
 * v1. `team` / `project` are protocol-reserved and never members — a Team is an
 * OrgUnit and a Project is a Collaboration (§12).
 */
export const MEMBER_PRINCIPAL_TYPES = ['person', 'agent', 'organization'] as const

export type MemberPrincipalType = (typeof MEMBER_PRINCIPAL_TYPES)[number]

export function isMemberPrincipalType(value: PrincipalType | string): value is MemberPrincipalType {
	return (MEMBER_PRINCIPAL_TYPES as readonly string[]).includes(value)
}

/** A member reference: the principal id plus what kind of principal it is. */
export interface MemberRef {
	principalId: string
	principalType: MemberPrincipalType
}

export interface OrganizationMembership {
	id: string
	organizationId: string
	member: MemberRef
	state: MembershipState
	roleIds: readonly string[]
	publicVisibility: MembershipVisibility
	startsAt: number
	expiresAt?: number
	acceptedAt?: number
	endedAt?: number
	issuedBy: string
	acceptedBy?: string
	revocationReasonCode?: string
}

/**
 * §7.1 / INV-O2: a membership becomes active only by the INVITEE's own act.
 * There is no code path that writes `active` on anyone's behalf — the check
 * lives here so every caller inherits it, and the acceptor identity is compared
 * against the invited principal rather than merely being non-empty.
 */
export function assertMembershipAcceptance(
	membership: Pick<OrganizationMembership, 'state' | 'member'>,
	acceptedBy: string
): void {
	if (membership.state !== 'invited') {
		throw new AlinkCoreError('INVALID_STATE', 'This invitation is no longer open')
	}
	if (acceptedBy !== membership.member.principalId) {
		throw new AlinkCoreError(
			'FORBIDDEN',
			'A membership invitation can only be accepted by the invited principal'
		)
	}
}

/** Whether a membership currently confers anything at all (§7.3 baseline). */
export function isMembershipLive(
	membership: Pick<OrganizationMembership, 'state' | 'startsAt' | 'expiresAt'>,
	now: number
): boolean {
	if (membership.state !== 'active') return false
	if (membership.startsAt > now) return false
	return membership.expiresAt === undefined || membership.expiresAt > now
}

/**
 * §45.1 / 拍板 2 counting rule for the free tier: only `active` memberships
 * consume the organization's seat budget. `invited` does not (an invitation
 * nobody accepted has cost the organization nothing), and neither do the
 * terminal states. Suspended DOES count — the seat is being held open.
 */
export function countsTowardActiveMembers(state: MembershipState): boolean {
	return state === 'active' || state === 'suspended'
}

// ---------------------------------------------------------------------------
// Capabilities (§8.1)

export const ORG_CAPABILITIES = [
	'org:profile:read',
	'org:profile:write',
	'org:intent:manage',
	'org:member:invite',
	'org:member:suspend',
	'org:role:assign',
	'org:delegation:manage',
	'org:collaboration:view',
	'org:collaboration:join_propose',
	'org:collaboration:represent',
	'org:commit:propose',
	'org:commit:approve',
	'org:outcome:recognize',
	'org:representative:manage',
	'org:audit:read',
	'org:control:admin'
] as const

export type OrgCapability = (typeof ORG_CAPABILITIES)[number]

export function isOrgCapability(value: unknown): value is OrgCapability {
	return typeof value === 'string' && (ORG_CAPABILITIES as readonly string[]).includes(value)
}

/**
 * §8.1 last line: `org:control:admin` never enters an ordinary role's default
 * set. Kept as a list rather than a single constant because the rule is
 * "capabilities that a role template may not carry", and that list will grow.
 */
export const ROLE_INELIGIBLE_CAPABILITIES: readonly OrgCapability[] = ['org:control:admin']

/**
 * §9.1 Protected Actions — reachable only through the control policy, never by
 * an ordinary grant, a Steward or an AI. These are named by ACTION rather than
 * by capability on purpose: `org:control:admin` is not a skeleton key that
 * satisfies them, it is merely the capability that lets someone PROPOSE one.
 */
export const PROTECTED_ACTIONS = [
	'org.controllers.rotate',
	'org.charter.amend_rights',
	'org.dissolve',
	'org.handle.transfer',
	'org.member.promote_controller',
	'org.commitment_policy.amend',
	'org.keys.export_or_rotate',
	'org.representative.enable_high_risk'
] as const

export type OrgProtectedAction = (typeof PROTECTED_ACTIONS)[number]

export function isProtectedAction(actionType: string): actionType is OrgProtectedAction {
	return (PROTECTED_ACTIONS as readonly string[]).includes(actionType)
}

/**
 * §8. A grant is the ONLY thing that produces permission. `resourceScope` is an
 * optional narrowing: absent means organization-wide, present means the grant
 * only answers for the listed resource refs (a collaboration id, an intent id).
 */
export interface OrgCapabilityGrant {
	id: string
	organizationId: string
	subject: string
	capability: OrgCapability
	resourceScope?: readonly string[]
	constraints?: Record<string, string | number | boolean>
	grantedBy: string
	sourceDecisionRef?: string
	startsAt: number
	expiresAt?: number
	revocable: boolean
	revokedAt?: number
}

export function isGrantLive(
	grant: Pick<OrgCapabilityGrant, 'startsAt' | 'expiresAt' | 'revokedAt'>,
	now: number
): boolean {
	if (grant.revokedAt !== undefined && grant.revokedAt <= now) return false
	if (grant.startsAt > now) return false
	return grant.expiresAt === undefined || grant.expiresAt > now
}

/**
 * Does this one grant answer for this capability on this resource? An unscoped
 * grant covers every resource; a scoped grant covers exactly its list — asking
 * a scoped grant an unscoped question (`resourceRef` omitted) is answered NO,
 * because "may act on collaboration X" is not "may act on collaborations".
 */
export function grantCovers(
	grant: Pick<OrgCapabilityGrant, 'capability' | 'resourceScope'>,
	capability: OrgCapability,
	resourceRef?: string
): boolean {
	if (grant.capability !== capability) return false
	if (!grant.resourceScope || grant.resourceScope.length === 0) return true
	if (resourceRef === undefined) return false
	return grant.resourceScope.includes(resourceRef)
}

/**
 * INV-O3 in one function signature: it takes GRANTS. There is deliberately no
 * parameter through which a role, a role name or a membership could reach this
 * decision — the invariant is enforced by what the function cannot see, which
 * is the only kind of enforcement that survives a refactor.
 */
export function hasCapability(
	grants: readonly OrgCapabilityGrant[],
	capability: OrgCapability,
	options: { subject: string; now: number; resourceRef?: string }
): boolean {
	return grants.some(
		(grant) =>
			grant.subject === options.subject &&
			isGrantLive(grant, options.now) &&
			grantCovers(grant, capability, options.resourceRef)
	)
}

/** The live capability set a subject actually holds — for Console rendering. */
export function effectiveCapabilities(
	grants: readonly OrgCapabilityGrant[],
	options: { subject: string; now: number }
): OrgCapability[] {
	const found = new Set<OrgCapability>()
	for (const grant of grants) {
		if (grant.subject !== options.subject) continue
		if (!isGrantLive(grant, options.now)) continue
		found.add(grant.capability)
	}
	return ORG_CAPABILITIES.filter((capability) => found.has(capability))
}

// ---------------------------------------------------------------------------
// Roles (§8)

export interface OrgRole {
	id: string
	name: string
	description?: string
	defaultCapabilities: readonly OrgCapability[]
	publicByDefault: boolean
}

/**
 * The starter role set every new organization gets. `Member` carries almost
 * nothing on purpose (§7.3): joining an organization is not being handed it.
 * These are TEMPLATES — assigning one materializes grants (see
 * `grantsForRoleAssignment`), and editing a role afterwards does not silently
 * re-grant anything.
 */
export const DEFAULT_ORG_ROLES: readonly Omit<OrgRole, 'id'>[] = [
	{
		name: 'Founder',
		defaultCapabilities: [
			'org:profile:read',
			'org:profile:write',
			'org:intent:manage',
			'org:member:invite',
			'org:member:suspend',
			'org:role:assign',
			'org:delegation:manage',
			'org:collaboration:view',
			'org:collaboration:join_propose',
			'org:collaboration:represent',
			'org:commit:propose',
			'org:outcome:recognize',
			'org:representative:manage',
			'org:audit:read'
		],
		publicByDefault: false
	},
	{
		name: 'Director',
		defaultCapabilities: [
			'org:profile:read',
			'org:intent:manage',
			'org:member:invite',
			'org:collaboration:view',
			'org:collaboration:join_propose',
			'org:collaboration:represent',
			'org:commit:propose',
			'org:audit:read'
		],
		publicByDefault: false
	},
	{
		name: 'Member',
		defaultCapabilities: ['org:profile:read', 'org:collaboration:view'],
		publicByDefault: false
	},
	{
		name: 'Advisor',
		defaultCapabilities: ['org:profile:read'],
		publicByDefault: false
	}
]

/**
 * Materialize a role assignment into explicit grants (INV-O3's write half).
 * Anything a role should not be able to hand out is dropped HERE rather than
 * being rejected later: a role template is data an admin can edit, so the
 * filter belongs on the path that turns it into permission.
 */
export function grantsForRoleAssignment(
	role: Pick<OrgRole, 'defaultCapabilities'>
): OrgCapability[] {
	return role.defaultCapabilities.filter(
		(capability) => !ROLE_INELIGIBLE_CAPABILITIES.includes(capability)
	)
}

// ---------------------------------------------------------------------------
// Charter (§6) and control policy (§9)

/**
 * §6.1 rights no charter may lower. Exported as data because they are shown to
 * an invitee before they accept (design prototype D5) and asserted in tests —
 * a promise that only exists in prose is a promise that drifts.
 */
export const UNWAIVABLE_MEMBER_RIGHTS = [
	'no_silent_membership',
	'may_leave',
	'own_private_data_self_authorized',
	'public_listing_requires_own_consent',
	'agent_action_disclosed',
	'personal_connections_not_absorbed',
	'org_commitment_never_becomes_personal',
	'revocation_is_auditable'
] as const

export type UnwaivableMemberRight = (typeof UNWAIVABLE_MEMBER_RIGHTS)[number]

export interface OrgControlPolicy {
	/** Principal ids that may satisfy protected actions. */
	controllers: readonly string[]
	threshold: number
	recoveryControllers: readonly string[]
	protectedActions: readonly OrgProtectedAction[]
	/** Whether a passkey step-up is required in addition to the threshold. */
	requireStepUp: boolean
}

/**
 * 拍板 1: a one-person studio is a first-class shape, not a degraded one. 1-of-1
 * is the default and stays the default forever — with an optional recovery
 * controller, because the failure mode of a single controller is not misuse,
 * it is a lost device.
 */
export function defaultControlPolicy(founderPrincipalId: string): OrgControlPolicy {
	return {
		controllers: [founderPrincipalId],
		threshold: 1,
		recoveryControllers: [],
		protectedActions: [...PROTECTED_ACTIONS],
		requireStepUp: true
	}
}

export function assertValidControlPolicy(policy: OrgControlPolicy): void {
	if (policy.controllers.length === 0) {
		throw new AlinkCoreError('INVALID_ARGUMENT', 'An organization needs at least one controller')
	}
	if (new Set(policy.controllers).size !== policy.controllers.length) {
		throw new AlinkCoreError('INVALID_ARGUMENT', 'Controllers must be distinct')
	}
	if (policy.threshold < 1 || policy.threshold > policy.controllers.length) {
		throw new AlinkCoreError(
			'INVALID_ARGUMENT',
			'Controller threshold must be between 1 and the number of controllers'
		)
	}
}

/** Whether a set of confirmations satisfies the control policy. */
export function controlSatisfied(
	policy: Pick<OrgControlPolicy, 'controllers' | 'threshold'>,
	confirmedBy: readonly string[]
): boolean {
	const distinct = new Set(confirmedBy.filter((id) => policy.controllers.includes(id)))
	return distinct.size >= policy.threshold
}

export interface OrgCharter {
	purpose: string
	organizationType: OrganizationType
	/** Whether members may invite, or only capability holders. Both still gate
	 * on `org:member:invite` — this only decides whether the role template for
	 * `Member` carries it, which is why it is a charter field and not a check. */
	admissionPolicy: 'invite_only' | 'capability_holders'
	rolePolicy: 'fixed' | 'custom'
	operationalDecisionPolicy: 'single_holder' | 'controller'
	/** §10.1: undefined means controller. Never widen this default. */
	externalCommitmentPolicy: 'controller' | 'delegated'
	publicDisclosurePolicy: 'opt_in' | 'closed'
	dissolutionPolicy: 'controller_threshold'
	version: number
	ratifiedBy: readonly string[]
	ratifiedAt: number
}

export function defaultCharter(input: {
	purpose: string
	organizationType?: OrganizationType
	founderPrincipalId: string
	now: number
}): OrgCharter {
	return {
		purpose: input.purpose,
		organizationType: input.organizationType ?? 'other',
		admissionPolicy: 'invite_only',
		rolePolicy: 'custom',
		operationalDecisionPolicy: 'single_holder',
		// §10.1 拍板 5 — strict by default; loosening is an explicit, logged act.
		externalCommitmentPolicy: 'controller',
		publicDisclosurePolicy: 'opt_in',
		dissolutionPolicy: 'controller_threshold',
		version: 1,
		ratifiedBy: [input.founderPrincipalId],
		ratifiedAt: input.now
	}
}

// ---------------------------------------------------------------------------
// Approval policies and instances (§10)

export interface OrgApprovalPolicy {
	id: string
	organizationId: string
	/** The domain action name this policy answers for, e.g. `org.commit.make`. */
	actionType: string
	/** Principal ids, or the sentinel `controllers` for the control set. */
	eligibleApprovers: readonly string[] | 'controllers'
	threshold: number
	/** When true the proposer may not be counted among the approvers (§10). */
	separationOfDuties: boolean
	amountOrRiskLimit?: number
	expiresAfterMs: number
	version: number
}

export type ApprovalState = 'pending' | 'satisfied' | 'rejected' | 'expired' | 'withdrawn'

export const APPROVAL_TRANSITIONS: Record<ApprovalState, readonly ApprovalState[]> = {
	pending: ['satisfied', 'rejected', 'expired', 'withdrawn'],
	satisfied: [],
	rejected: [],
	expired: [],
	withdrawn: []
}

/** How long an unattended approval stays open before it lapses (§10). */
export const APPROVAL_DEFAULT_TTL_MS = 7 * 86_400_000

/**
 * Domain actions that are external commitments — the ones §10.1 keeps on the
 * controller by default. Named rather than inferred: "is this an outward
 * promise" is a product judgement, and a heuristic on the action string would
 * quietly answer no for the next one somebody adds.
 */
export const EXTERNAL_COMMITMENT_ACTIONS: readonly string[] = [
	'org.commitment.authorize',
	'org.outcome.recognize',
	'org.collaboration.accept_party',
	'org.capsule.share',
	// WP-K6. Every one of these is the organization SAYING something at a table
	// other principals are sitting at: agreeing to a decision that binds it,
	// accepting somebody's delivery as done, changing a promise it already made.
	// They join the list rather than falling through to 「explicit policy or
	// controllers」 because the fallthrough's loose end is an organization that
	// wrote one permissive policy row years ago and now authorizes outward
	// promises through it (「默认从严，放宽有痕」).
	'org.decision.authorize',
	'org.fulfillment.recognize',
	'org.commitment.change'
]

/**
 * §10.1 拍板 5. The resolution ORDER is the decision, and the order runs from
 * strictest to loosest — never the other way:
 *
 * 1. A protected action (§9.1) is the control policy's, always. No approval-
 *    policy row can answer for it, which is why the row is consulted second and
 *    not first.
 * 2. An external commitment under a charter that never widened
 *    `externalCommitmentPolicy` is also the controller's — an explicit policy
 *    row is IGNORED rather than honoured. Editing that charter field is itself
 *    a protected action, so the looser rule cannot exist without a trace
 *    (「默认从严，放宽有痕」).
 * 3. Otherwise an explicit policy for this exact action wins.
 * 4. Otherwise: controllers. There is deliberately no permissive fallthrough.
 */
export function resolveApprovalPolicy(input: {
	organizationId: string
	actionType: string
	charter: Pick<OrgCharter, 'externalCommitmentPolicy'>
	controlPolicy: Pick<OrgControlPolicy, 'threshold'>
	policies: readonly OrgApprovalPolicy[]
}): OrgApprovalPolicy {
	const controllerPolicy: OrgApprovalPolicy = {
		id: `oap_default:${input.actionType}`,
		organizationId: input.organizationId,
		actionType: input.actionType,
		eligibleApprovers: 'controllers',
		threshold: input.controlPolicy.threshold,
		separationOfDuties: false,
		expiresAfterMs: APPROVAL_DEFAULT_TTL_MS,
		version: 0
	}
	if (isProtectedAction(input.actionType)) return controllerPolicy
	if (
		EXTERNAL_COMMITMENT_ACTIONS.includes(input.actionType) &&
		input.charter.externalCommitmentPolicy !== 'delegated'
	) {
		return controllerPolicy
	}
	return input.policies.find((policy) => policy.actionType === input.actionType) ?? controllerPolicy
}

export interface OrgApprovalVote {
	approverId: string
	decision: 'approve' | 'reject'
	at: number
	/** Present when the approver re-proved control (passkey step-up). */
	stepUpProofRef?: string
}

export interface OrgApprovalInstance {
	id: string
	organizationId: string
	actionType: string
	actionDigest: string
	policyVersion: number
	proposedBy: string
	votes: readonly OrgApprovalVote[]
	state: ApprovalState
	createdAt: number
	expiresAt: number
}

export interface ApprovalEvaluation {
	state: ApprovalState
	/** How many more eligible approvals are needed; 0 once satisfied. */
	remaining: number
	/** The votes that actually counted — what the Authorization will reference. */
	countedBy: readonly string[]
}

/**
 * Evaluate an approval instance against its policy. A single reject ends it:
 * this is not a vote where a majority carries — an organization's internal rule
 * says who must agree, and someone eligible saying no means the rule is not
 * met (§18 多数票不能替代受影响者同意, applied inward).
 */
export function evaluateApproval(input: {
	policy: Pick<OrgApprovalPolicy, 'eligibleApprovers' | 'threshold' | 'separationOfDuties'>
	controllers: readonly string[]
	instance: Pick<OrgApprovalInstance, 'votes' | 'proposedBy' | 'expiresAt' | 'state'>
	now: number
}): ApprovalEvaluation {
	const { policy, instance } = input
	if (instance.state !== 'pending') {
		return { state: instance.state, remaining: 0, countedBy: [] }
	}
	const eligible =
		policy.eligibleApprovers === 'controllers'
			? input.controllers
			: (policy.eligibleApprovers as readonly string[])

	const counted: string[] = []
	for (const vote of instance.votes) {
		if (!eligible.includes(vote.approverId)) continue
		// ⚠️ The reject is read BEFORE separation of duties, and that order is the
		// rule: 「他的同意不算」 never means 「他的反对不算」. Skipped first, a
		// proposer's own no was written into `votes_json` and then ignored — the
		// instance answered 200 `pending` and sat there for the whole TTL (nothing
		// writes `withdrawn`, so its author could not take it back either), and the
		// swallowed vote would have started counting the day somebody turned
		// separation of duties off.
		if (vote.decision === 'reject') {
			return { state: 'rejected', remaining: 0, countedBy: [vote.approverId] }
		}
		if (policy.separationOfDuties && vote.approverId === instance.proposedBy) continue
		if (!counted.includes(vote.approverId)) counted.push(vote.approverId)
	}
	if (counted.length >= policy.threshold) {
		return { state: 'satisfied', remaining: 0, countedBy: counted }
	}
	// Expiry is evaluated AFTER satisfaction: an approval that reached its
	// threshold before the deadline stays satisfied even if nobody read the
	// result until afterwards. Lazy settlement (devplan TD-6) means "expired" is
	// a projection, and a projection must not lose a decision already made.
	if (instance.expiresAt <= input.now) {
		return { state: 'expired', remaining: policy.threshold - counted.length, countedBy: counted }
	}
	return {
		state: 'pending',
		remaining: policy.threshold - counted.length,
		countedBy: counted
	}
}

// ---------------------------------------------------------------------------
// OrganizationAuthorization (§10, devplan TD-4)

/**
 * The action an authorization is FOR, canonicalized into a digest. Keeping the
 * descriptor structured (rather than hashing a free string) is what makes the
 * binding checkable on the other side: a Collaboration verifying an
 * authorization recomputes this digest from the action IT is about to perform,
 * so an authorization minted for one commitment can never be replayed onto
 * another (§44 内部政策伪造).
 */
export interface OrganizationActionDescriptor {
	organizationId: string
	actionType: string
	/** What the action is about — a collaboration id, a commitment id, a handle. */
	target: string
	/** The action's material parameters. Anything that changes the meaning of
	 * the action must be in here, or the digest is not a binding. */
	params: Record<string, string | number | boolean | null>
}

export function organizationActionMaterial(action: OrganizationActionDescriptor): string {
	return canonicalJson({
		organizationId: action.organizationId,
		actionType: action.actionType,
		target: action.target,
		params: action.params
	})
}

/** base64url(SHA-256(JCS(action))) — the `actionDigest` of §10. */
export async function computeActionDigest(action: OrganizationActionDescriptor): Promise<string> {
	const bytes = new TextEncoder().encode(organizationActionMaterial(action))
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	let binary = ''
	for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * §10's signed object. What is NOT in it is the point (拍板 6): no approver
 * names, no thresholds, no discussion. Another Party learns that this
 * organization validly authorized this exact action, and nothing else about how
 * it decided — `approvalRefs` are opaque ids meaningful only inside the
 * organization's own audit chain.
 */
export interface OrganizationAuthorization {
	id: string
	organizationId: string
	actionDigest: string
	policyVersion: number
	approvalRefs: readonly string[]
	validFrom: number
	expiresAt?: number
	nonce: string
	/** base64url Ed25519 over `organizationAuthorizationMaterial`. */
	signature: string
	/** The organization signing key's did:agent, for verification. */
	signerDid: string
}

/** Default life of an authorization: long enough to act, short enough to matter. */
export const AUTHORIZATION_DEFAULT_TTL_MS = 24 * 3_600_000

/** The exact bytes that get signed. Signature-relevant fields only. */
export function organizationAuthorizationMaterial(
	authorization: Omit<OrganizationAuthorization, 'signature'>
): string {
	return canonicalJson({
		id: authorization.id,
		organizationId: authorization.organizationId,
		actionDigest: authorization.actionDigest,
		policyVersion: authorization.policyVersion,
		approvalRefs: [...authorization.approvalRefs].sort(),
		validFrom: authorization.validFrom,
		expiresAt: authorization.expiresAt ?? null,
		nonce: authorization.nonce,
		signerDid: authorization.signerDid
	})
}

/**
 * Everything about an authorization that can be checked WITHOUT a key: it is
 * for this organization, for this exact action, inside its window, and its
 * nonce has not been seen. The signature check is the caller's other half
 * (services/org-crypto.ts) — split this way so the whole replay-and-binding
 * surface is testable as pure functions.
 */
export function assertAuthorizationBinding(
	authorization: Pick<
		OrganizationAuthorization,
		'organizationId' | 'actionDigest' | 'validFrom' | 'expiresAt' | 'nonce'
	>,
	expected: {
		organizationId: string
		actionDigest: string
		now: number
		seenNonces: ReadonlySet<string>
	}
): void {
	if (authorization.organizationId !== expected.organizationId) {
		throw new AlinkCoreError('FORBIDDEN', 'This authorization belongs to another organization')
	}
	if (authorization.actionDigest !== expected.actionDigest) {
		throw new AlinkCoreError('FORBIDDEN', 'This authorization was issued for a different action')
	}
	if (authorization.validFrom > expected.now) {
		throw new AlinkCoreError('FORBIDDEN', 'This authorization is not valid yet')
	}
	if (authorization.expiresAt !== undefined && authorization.expiresAt <= expected.now) {
		throw new AlinkCoreError('FORBIDDEN', 'This authorization has expired')
	}
	if (expected.seenNonces.has(authorization.nonce)) {
		throw new AlinkCoreError('FORBIDDEN', 'This authorization was already used')
	}
}

// ---------------------------------------------------------------------------
// Acting context (§39) — the model's highest-risk surface

/**
 * Who a write is being made BY and FOR. Every organization write carries one,
 * the signature binds it, and the UI shows it without being asked (design
 * prototype D2). `self` and `organization` are not two skins on one action:
 * they produce different obligors, and §23.3 says the person is not one of them.
 */
export type ActingContext =
	| { kind: 'self'; actorPrincipalId: string }
	| { kind: 'organization'; actorPrincipalId: string; organizationId: string }

/**
 * §39: switching acting context must not carry an unsubmitted draft across.
 * The rule is expressed as a comparison rather than a flag so callers cannot
 * accidentally treat "same person, different hat" as "no change".
 */
export function actingContextChanged(before: ActingContext, after: ActingContext): boolean {
	if (before.kind !== after.kind) return true
	if (before.actorPrincipalId !== after.actorPrincipalId) return true
	return (
		before.kind === 'organization' &&
		after.kind === 'organization' &&
		before.organizationId !== after.organizationId
	)
}

/**
 * The organization an acting context speaks for, or null. Reads as trivial;
 * exists so that no call site has to write `ctx.kind === 'organization' ? …`
 * and get the polarity wrong once.
 */
export function actsForOrganization(context: ActingContext): string | null {
	return context.kind === 'organization' ? context.organizationId : null
}

// ---------------------------------------------------------------------------
// Deliberately absent (§51)

/**
 * Tool names that must never exist. Asserted against the MCP catalog in
 * `test/domain-collaboration.test.mjs` — the same lock `sprite.wake` has on the
 * other side (a surface that must exist is easy to test for; a surface that
 * must NOT exist needs someone to have written down that it must not).
 */
export const DELIBERATELY_ABSENT_ORG_TOOLS = [
	'org.accept_member_for_person',
	'org.self_approve_commitment',
	'org.add_controller',
	'org.dissolve',
	'org.export_private_member_data'
] as const

// ---------------------------------------------------------------------------
// Transition guards

export function canTransitionOrganization(from: OrganizationState, to: OrganizationState): boolean {
	return ORGANIZATION_TRANSITIONS[from].includes(to)
}

export function assertOrganizationTransition(from: OrganizationState, to: OrganizationState): void {
	if (!canTransitionOrganization(from, to)) {
		throw new AlinkCoreError(
			'INVALID_STATE_TRANSITION',
			`Invalid organization state transition from ${from} to ${to}`
		)
	}
}

export function canTransitionMembership(from: MembershipState, to: MembershipState): boolean {
	return MEMBERSHIP_TRANSITIONS[from].includes(to)
}

export function assertMembershipTransition(from: MembershipState, to: MembershipState): void {
	if (!canTransitionMembership(from, to)) {
		throw new AlinkCoreError(
			'INVALID_STATE_TRANSITION',
			`Invalid membership state transition from ${from} to ${to}`
		)
	}
}

export function canTransitionApproval(from: ApprovalState, to: ApprovalState): boolean {
	return APPROVAL_TRANSITIONS[from].includes(to)
}

export function assertApprovalTransition(from: ApprovalState, to: ApprovalState): void {
	if (!canTransitionApproval(from, to)) {
		throw new AlinkCoreError(
			'INVALID_STATE_TRANSITION',
			`Invalid approval state transition from ${from} to ${to}`
		)
	}
}
