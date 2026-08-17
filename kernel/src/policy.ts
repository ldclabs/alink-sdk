import { missingScopes, requiredScopesFor, requiresIdempotency } from './tools.js'
import type {
	DecisionStatus,
	PolicyContext,
	PolicyDecision,
	PolicyInput,
	PolicyResource,
	ReasonCode,
	Redaction,
	RelationshipPermission,
	RelationshipPermissionLevel,
	RelationshipPermissionScope,
	RequestType,
	Sensitivity,
	ToolAction
} from './types.js'

const EMPTY_ACTIONS: readonly ToolAction[] = []

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
	const requiredScopes = requiredScopesFor(input.action)
	const missing = missingScopes(input.actor.scopes, requiredScopes)
	if (missing.length > 0) {
		return denied(0.9, ['SCOPE_MISSING'], ['hide_contact_channels', 'hide_private_note'])
	}

	if (requiresIdempotency(input.action) && !input.resource?.idempotencyKey) {
		return denied(0.55, ['IDEMPOTENCY_REQUIRED'], [])
	}

	if (
		input.resource?.bulkCount &&
		input.resource.bulkCount > 1 &&
		isRelationshipActivationAction(input.action)
	) {
		return denied(0.85, ['BULK_ACTION_DENIED'], ['hide_second_degree_path'])
	}

	if (
		(input.context?.graphSearchBreadth ?? 0) > 50 ||
		input.resource?.includesSecondDegreePath === true
	) {
		return denied(
			0.8,
			['GRAPH_SCRAPING_RISK'],
			['hide_second_degree_path', 'hide_contact_channels']
		)
	}

	const relationshipState = input.resource?.relationship?.state
	if (relationshipState === 'revoked') {
		return denied(0.9, ['RELATIONSHIP_REVOKED'], ['hide_contact_channels', 'hide_private_note'])
	}
	if (relationshipState === 'muted' && isRelationshipActivationAction(input.action)) {
		return denied(0.75, ['RELATIONSHIP_MUTED'], ['hide_contact_channels'])
	}

	switch (input.action) {
		case 'relationship.search':
		case 'relationship.get':
		case 'intent.match_relationships':
		// Network-wide discovery (discovery design D8) reads through the same
		// gate as first-degree matching: the graphSearchBreadth scrape guard
		// above already applies, and the default read decision keeps contact
		// channels redacted — discovery results never carry a contact surface.
		case 'intent.discover':
		case 'network.path_to':
			return evaluateReadPolicy(input)
		case 'outreach.draft':
			return evaluateDraftPolicy(input)
		case 'request.create_activation':
		case 'request.send_to_agent':
			return evaluateActivationPolicy(input)
		case 'relationship.create_from_encounter':
		case 'relationship.update_context':
		case 'intent.create':
		case 'inbox.respond':
			return evaluateMutationPolicy(input)
		case 'approval.submit':
		case 'consent.grant':
			return approvalRequired(0.4, ['POLICY_ALLOWED'], [])
		case 'consent.revoke':
			return allowed(0.1, ['POLICY_ALLOWED'], [])
		default:
			return allowed(0.1, ['SCOPE_ALLOWED', 'POLICY_ALLOWED'], [])
	}
}

export function calculateRiskScore(
	resource: PolicyResource = {},
	context: PolicyContext = {}
): number {
	const temperature = clamp01(
		context.relationshipTemperature ?? resource.relationship?.temperature ?? 0.1
	)
	const relationshipColdness = 1 - temperature
	const requestIntrusiveness = requestIntrusivenessScore(resource.requestType)
	const targetSensitivity = sensitivityScore(
		resource.relationship?.sensitivity ?? context.messageSensitivity ?? 'medium'
	)
	const frequencyPressure = clamp01((context.frequency30d ?? 0) / 3)
	const agentReputationRisk = clamp01(context.agentReputationRisk ?? 0)
	const contentSensitivity = context.containsSensitiveInfo
		? Math.max(0.7, targetSensitivity)
		: sensitivityScore(context.messageSensitivity ?? 'low')

	return roundScore(
		0.25 * relationshipColdness +
			0.2 * requestIntrusiveness +
			0.2 * targetSensitivity +
			0.15 * frequencyPressure +
			0.1 * agentReputationRisk +
			0.1 * contentSensitivity
	)
}

export function permissionScopeForRequestType(
	requestType: RequestType | undefined
): RelationshipPermissionScope {
	switch (requestType) {
		case 'meeting':
			return 'meeting:request'
		case 'intro':
			return 'intro:request'
		case 'chat':
		case 'ask_question':
			return 'contact:ask'
		case 'update_context':
			return 'context:share'
		default:
			return 'contact:ask'
	}
}

export function pickRelationshipPermission(
	permissions: readonly RelationshipPermission[] | undefined,
	scope: RelationshipPermissionScope,
	topics: readonly string[] = []
): RelationshipPermission | undefined {
	const candidates =
		permissions?.filter((permission) => permission.scope === scope && !permission.revokedAt) ?? []
	if (candidates.length === 0) return undefined

	return candidates.find((permission) => topicsAllowed(permission, topics)) ?? candidates[0]
}

function evaluateReadPolicy(input: PolicyInput): PolicyDecision {
	const riskScore = calculateRiskScore(input.resource, input.context)
	const nextActions: ToolAction[] = ['outreach.draft', 'request.create_activation']
	const wantsSensitive = input.context?.requestedSensitiveFields === true
	const canReadSensitive = input.actor.scopes.includes('relationships:sensitive_read')

	// Sensitive read explicitly requested AND granted: full read, nothing hidden.
	// This is the only path that exposes the private note / contact channels.
	if (wantsSensitive && canReadSensitive) {
		return decision(
			'allowed',
			riskScore,
			['RELATIONSHIPS_READ_ALLOWED', 'SENSITIVE_READ_GRANTED'],
			[],
			nextActions
		)
	}

	// Sensitive requested but the scope is missing: hide everything sensitive.
	if (wantsSensitive) {
		return decision(
			'redacted',
			riskScore,
			['SENSITIVE_READ_NOT_GRANTED', 'SENSITIVE_FIELDS_REDACTED'],
			['hide_private_note', 'hide_contact_channels', 'hide_sensitive_summary'],
			nextActions
		)
	}

	// Default public view: private note and contact channels always redacted.
	return decision(
		'redacted',
		riskScore,
		['RELATIONSHIPS_READ_ALLOWED', 'SENSITIVE_FIELDS_REDACTED'],
		['hide_private_note', 'hide_contact_channels'],
		nextActions
	)
}

function evaluateDraftPolicy(input: PolicyInput): PolicyDecision {
	const riskScore = calculateRiskScore(input.resource, input.context)
	const reasons: ReasonCode[] = ['SCOPE_ALLOWED']
	const redactions: Redaction[] = ['hide_private_note', 'hide_contact_channels']

	if (isWeakTie(input)) {
		reasons.push('WEAK_TIE')
	}
	if (riskScore >= 0.75) {
		reasons.push('HIGH_RISK')
	}

	return decision('draft_only', riskScore, reasons, redactions, ['request.create_activation'])
}

function evaluateActivationPolicy(input: PolicyInput): PolicyDecision {
	const requestType = input.resource?.requestType
	const riskScore = calculateRiskScore(input.resource, input.context)
	const reasons: ReasonCode[] = ['SCOPE_ALLOWED']
	const redactions: Redaction[] = ['hide_private_note']

	if (requestType === 'meeting') reasons.push('MEETING_REQUEST')
	if (requestType === 'intro') reasons.push('INTRO_REQUEST')
	if (isWeakTie(input)) reasons.push('WEAK_TIE')
	if (riskScore >= 0.75) reasons.push('HIGH_RISK')

	const permissionScope = permissionScopeForRequestType(requestType)
	const topics = input.resource?.topics ?? []
	const permission = pickRelationshipPermission(
		input.resource?.relationship?.permissions,
		permissionScope,
		topics
	)

	if (permission && !topicsAllowed(permission, topics)) {
		return denied(Math.max(riskScore, 0.65), ['TOPIC_RESTRICTED'], ['hide_contact_channels'])
	}

	const permissionLevel = permission?.allowedLevel ?? defaultPermissionLevel(input)
	appendPermissionReason(reasons, permissionLevel)

	if (permissionLevel === 'denied' || riskScore > 0.85) {
		return denied(Math.max(riskScore, 0.8), reasons, ['hide_contact_channels', 'hide_private_note'])
	}

	if (permissionLevel === 'draft_only') {
		return decision('draft_only', riskScore, reasons, redactions, ['outreach.draft'])
	}

	if (permissionLevel === 'approval_required' || riskScore >= 0.5 || requestType === 'intro') {
		return approvalRequired(riskScore, reasons, redactions)
	}

	return allowed(riskScore, [...reasons, 'FREQUENCY_OK'], redactions, ['request.send_to_agent'])
}

function evaluateMutationPolicy(input: PolicyInput): PolicyDecision {
	const riskScore = calculateRiskScore(input.resource, input.context)
	if (riskScore >= 0.75 || input.context?.containsSensitiveInfo === true) {
		return approvalRequired(riskScore, ['HIGH_RISK'], ['hide_private_note'])
	}

	return allowed(riskScore, ['POLICY_ALLOWED'], [])
}

function defaultPermissionLevel(input: PolicyInput): RelationshipPermissionLevel {
	const requestType = input.resource?.requestType
	const trustLevel = input.context?.trustLevel ?? input.resource?.relationship?.trustLevel ?? 'weak'
	const frequency30d = input.context?.frequency30d ?? 0

	if (requestType === 'intro') return 'approval_required'
	// `intimate` is banned at the product layer (product doc §6.6); if one ever
	// reaches the engine, never auto-allow — escalate to a human (defense in depth).
	if (trustLevel === 'intimate') return 'approval_required'
	if (frequency30d > 1 && (trustLevel === 'weak' || trustLevel === 'warm'))
		return 'approval_required'
	if (trustLevel === 'trusted' || trustLevel === 'collaborator') return 'auto_allowed'
	if (trustLevel === 'warm' && requestType === 'ask_question') return 'auto_allowed'
	if (trustLevel === 'weak' && requestType === 'chat') return 'approval_required'
	if (trustLevel === 'weak') return 'approval_required'

	return 'draft_only'
}

function isRelationshipActivationAction(action: ToolAction): boolean {
	return (
		action === 'request.create_activation' ||
		action === 'request.send_to_agent' ||
		action === 'inbox.respond'
	)
}

function isWeakTie(input: PolicyInput): boolean {
	const trustLevel = input.context?.trustLevel ?? input.resource?.relationship?.trustLevel ?? 'weak'
	const temperature =
		input.context?.relationshipTemperature ?? input.resource?.relationship?.temperature ?? 0.1
	return trustLevel === 'weak' || temperature < 0.45
}

function appendPermissionReason(reasons: ReasonCode[], level: RelationshipPermissionLevel): void {
	switch (level) {
		case 'auto_allowed':
			reasons.push('AUTO_PERMISSION')
			return
		case 'approval_required':
			reasons.push('APPROVAL_REQUIRED_BY_PERMISSION')
			return
		case 'draft_only':
			reasons.push('DRAFT_ONLY_BY_PERMISSION')
			return
		case 'denied':
			reasons.push('NO_STANDING_PERMISSION')
			return
	}
}

function topicsAllowed(
	permission: RelationshipPermission,
	requestedTopics: readonly string[]
): boolean {
	const allowedTopics = permission.constraints?.topics
	// No topic constraint on this permission: nothing to restrict.
	if (!allowedTopics || allowedTopics.length === 0) return true
	// A topic-scoped permission must not be satisfiable by declaring no topics —
	// that would let an agent bypass the whitelist by omission (unverifiable →
	// not allowed).
	if (requestedTopics.length === 0) return false

	const normalizedAllowed = new Set(allowedTopics.map(normalizeTopic))
	return requestedTopics.every((topic) => normalizedAllowed.has(normalizeTopic(topic)))
}

function normalizeTopic(topic: string): string {
	return topic.trim().toLowerCase()
}

function requestIntrusivenessScore(requestType: RequestType | undefined): number {
	switch (requestType) {
		case 'intro':
			return 0.85
		case 'meeting':
			return 0.7
		case 'chat':
			return 0.45
		case 'ask_question':
			return 0.35
		case 'update_context':
			return 0.2
		default:
			return 0.3
	}
}

function sensitivityScore(sensitivity: Sensitivity): number {
	switch (sensitivity) {
		case 'low':
			return 0.1
		case 'medium':
			return 0.45
		case 'high':
			return 0.75
		case 'highly_sensitive':
			return 1
	}
}

function denied(
	riskScore: number,
	reasonCodes: readonly ReasonCode[],
	redactions: readonly Redaction[]
): PolicyDecision {
	return decision('denied', riskScore, reasonCodes, redactions, EMPTY_ACTIONS)
}

function approvalRequired(
	riskScore: number,
	reasonCodes: readonly ReasonCode[],
	redactions: readonly Redaction[]
): PolicyDecision {
	return {
		...decision('approval_required', riskScore, reasonCodes, redactions, [
			'approval.get_status',
			'approval.submit'
		]),
		requiredApproval: {
			approvalType: 'human_confirm_send',
			expiresInMinutes: 120
		}
	}
}

function allowed(
	riskScore: number,
	reasonCodes: readonly ReasonCode[],
	redactions: readonly Redaction[],
	allowedActions: readonly ToolAction[] = []
): PolicyDecision {
	return decision('allowed', riskScore, reasonCodes, redactions, allowedActions)
}

function decision(
	status: DecisionStatus,
	riskScore: number,
	reasonCodes: readonly ReasonCode[],
	redactions: readonly Redaction[],
	allowedActions: readonly ToolAction[]
): PolicyDecision {
	return {
		status,
		riskScore: roundScore(clamp01(riskScore)),
		redactions: unique(redactions),
		reasonCodes: unique(reasonCodes),
		allowedActions
	}
}

function unique<T>(values: readonly T[]): readonly T[] {
	return [...new Set(values)]
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.min(1, Math.max(0, value))
}

function roundScore(value: number): number {
	return Math.round(value * 100) / 100
}
