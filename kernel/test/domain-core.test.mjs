import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
	AlinkCoreError,
	assertAgentRequestTransition,
	assertIdempotencyKey,
	calculateMatchScore,
	calculateRelationshipTemperature,
	canTransitionAgentRequest,
	canTransitionIntake,
	canonicalJson,
	contractDefaultsFor,
	createRequestFingerprint,
	evaluateIntakeRules,
	evaluatePolicy,
	isValidPrefixedId,
	makeId,
	makeTraceId,
	toTriageReason,
	permissionFitScore,
	redactRelationship,
	resolveIdempotency,
	signWebhook,
	verifyWebhookSignature
} from '../src/index.js'

const baseActor = {
	userId: '00000000000000000001',
	agentId: 'agt_test',
	scopes: ['relationships:read', 'requests:write', 'drafts:write'],
	actorKind: 'agent',
	riskLevel: 'normal'
}

function contractFrom(templateId) {
	return {
		id: 'contract_x',
		principalUserId: '00000000000000000001',
		version: 1,
		active: true,
		effectiveFrom: Date.UTC(2026, 0, 1),
		createdAt: Date.UTC(2026, 0, 1),
		updatedAt: Date.UTC(2026, 0, 1),
		...contractDefaultsFor(templateId)
	}
}

test('sensitive relationship read is only exposed when the scope is granted', () => {
	const withScope = evaluatePolicy({
		actor: { ...baseActor, scopes: ['relationships:read', 'relationships:sensitive_read'] },
		action: 'relationship.get',
		context: { requestedSensitiveFields: true }
	})
	assert.equal(withScope.status, 'allowed')
	assert.ok(withScope.reasonCodes.includes('SENSITIVE_READ_GRANTED'))
	assert.equal(withScope.redactions.length, 0)

	const withoutScope = evaluatePolicy({
		actor: { ...baseActor, scopes: ['relationships:read'] },
		action: 'relationship.get',
		context: { requestedSensitiveFields: true }
	})
	assert.equal(withoutScope.status, 'redacted')
	assert.ok(withoutScope.redactions.includes('hide_private_note'))
	assert.ok(withoutScope.reasonCodes.includes('SENSITIVE_READ_NOT_GRANTED'))
})

test('a topic-scoped permission cannot be bypassed by declaring no topics', () => {
	const permission = {
		scope: 'meeting:request',
		allowedLevel: 'auto_allowed',
		constraints: { topics: ['fundraising'] }
	}
	const denied = evaluatePolicy({
		actor: { ...baseActor, scopes: ['requests:write'] },
		action: 'request.create_activation',
		resource: {
			requestType: 'meeting',
			topics: [],
			idempotencyKey: 'k12345678',
			relationship: {
				state: 'active_weak',
				trustLevel: 'trusted',
				temperature: 0.8,
				permissions: [permission]
			}
		}
	})
	assert.equal(denied.status, 'denied')
	assert.ok(denied.reasonCodes.includes('TOPIC_RESTRICTED'))
})

test('intake rule layer filters by type, honeypot, and required context', () => {
	const investor = contractFrom('investor')

	const honeypot = evaluateIntakeRules(investor, {
		requestType: 'pitch',
		topics: [],
		providedContextFields: [],
		recentFromSender: 0,
		honeypotTripped: true
	})
	assert.equal(honeypot.action, 'reject')
	assert.equal(honeypot.band, 'auto_declined')

	const wrongType = evaluateIntakeRules(investor, {
		requestType: 'collaboration',
		topics: [],
		providedContextFields: [],
		recentFromSender: 0,
		honeypotTripped: false
	})
	assert.equal(wrongType.action, 'reject')

	const needContext = evaluateIntakeRules(investor, {
		requestType: 'pitch',
		topics: ['ai'],
		providedContextFields: ['deckUrl'],
		recentFromSender: 0,
		honeypotTripped: false
	})
	assert.equal(needContext.action, 'need_context')
	assert.ok(needContext.missingFields.includes('stage'))

	const escalate = evaluateIntakeRules(investor, {
		requestType: 'intro',
		topics: ['ai'],
		providedContextFields: ['targetPerson', 'reason', 'relationship'],
		recentFromSender: 0,
		honeypotTripped: false
	})
	assert.equal(escalate.action, 'escalate')
})

test('rule reasons carry codes + params so the console can localize them', () => {
	const investor = contractFrom('investor')

	const wrongType = evaluateIntakeRules(investor, {
		requestType: 'collaboration',
		topics: [],
		providedContextFields: [],
		recentFromSender: 0,
		honeypotTripped: false
	})
	// The chip the owner sees used to be the literal sentence
	// "request type 'collaboration' is not accepted" — English, under a localized heading.
	assert.deepEqual(wrongType.reasons, [
		{ kind: 'code', code: 'request_type_not_accepted', params: { type: 'collaboration' } }
	])

	const needContext = evaluateIntakeRules(investor, {
		requestType: 'pitch',
		topics: ['ai'],
		providedContextFields: ['deckUrl'],
		recentFromSender: 0,
		honeypotTripped: false
	})
	assert.equal(needContext.reasons[0].code, 'missing_context')
	assert.ok(needContext.reasons[0].params.fields.includes('stage'))
})

test('stored reasons decode both the structured shape and pre-split bare strings', () => {
	// Rows written before the split hold plain strings. They must keep rendering —
	// as passthrough text, exactly as they do today — not vanish from the inbox.
	assert.deepEqual(toTriageReason('no verifiable link'), {
		kind: 'text',
		text: 'no verifiable link'
	})
	assert.deepEqual(toTriageReason({ kind: 'text', text: 'generic template wording' }), {
		kind: 'text',
		text: 'generic template wording'
	})
	assert.deepEqual(toTriageReason({ kind: 'code', code: 'honeypot' }), {
		kind: 'code',
		code: 'honeypot'
	})
	assert.deepEqual(
		toTriageReason({ kind: 'code', code: 'topic_blocked', params: { topic: 'x' } }),
		{
			kind: 'code',
			code: 'topic_blocked',
			params: { topic: 'x' }
		}
	)
	assert.equal(toTriageReason(null), null)
	assert.equal(toTriageReason(42), null)
})

test('intake state machine allows a declined item to be reopened for review', () => {
	assert.equal(canTransitionIntake('declined', 'triaged'), true)
	assert.equal(canTransitionIntake('triaged', 'approved'), true)
	assert.equal(canTransitionIntake('approved', 'triaged'), false)
	assert.equal(canTransitionIntake('closed', 'triaged'), false)
})

test('generates and validates prefixed ids without caller-supplied randomness', () => {
	const id = makeId('rel', new Date('2026-07-01T00:00:00.000Z'))
	const traceId = makeTraceId(new Date('2026-07-01T00:00:00.000Z'))

	assert.equal(isValidPrefixedId(id, 'rel'), true)
	assert.equal(isValidPrefixedId(traceId, 'trace'), true)
	assert.match(id, /^rel_[0-9A-HJKMNP-TV-Z]{26}$/)
})

test('denies a tool call when OAuth scope is missing', () => {
	const decision = evaluatePolicy({
		actor: { ...baseActor, scopes: [] },
		action: 'relationship.search'
	})

	assert.equal(decision.status, 'denied')
	assert.equal(decision.reasonCodes.includes('SCOPE_MISSING'), true)
})

test('redacts relationship reads by default', () => {
	const decision = evaluatePolicy({
		actor: baseActor,
		action: 'relationship.search',
		context: { requestedSensitiveFields: true }
	})

	assert.equal(decision.status, 'redacted')
	assert.equal(decision.redactions.includes('hide_contact_channels'), true)
	assert.equal(decision.reasonCodes.includes('SENSITIVE_READ_NOT_GRANTED'), true)
})

test('requires human approval for weak-tie meeting activation', () => {
	const decision = evaluatePolicy({
		actor: baseActor,
		action: 'request.create_activation',
		resource: {
			requestType: 'meeting',
			idempotencyKey: 'req-rel01-meeting',
			relationship: {
				state: 'active_weak',
				trustLevel: 'weak',
				temperature: 0.3
			}
		},
		context: {
			frequency30d: 1,
			messageSensitivity: 'medium'
		}
	})

	assert.equal(decision.status, 'approval_required')
	assert.equal(decision.reasonCodes.includes('WEAK_TIE'), true)
	assert.equal(decision.requiredApproval?.approvalType, 'human_confirm_send')
})

test('allows low-risk trusted ask when relationship permission permits it', () => {
	const decision = evaluatePolicy({
		actor: baseActor,
		action: 'request.create_activation',
		resource: {
			requestType: 'ask_question',
			idempotencyKey: 'ask-trusted-001',
			topics: ['AI hardware'],
			relationship: {
				state: 'active_trusted',
				trustLevel: 'trusted',
				temperature: 0.92,
				sensitivity: 'low',
				permissions: [
					{
						scope: 'contact:ask',
						allowedLevel: 'auto_allowed',
						constraints: { topics: ['AI hardware'] }
					}
				]
			}
		},
		context: {
			frequency30d: 0,
			messageSensitivity: 'low'
		}
	})

	assert.equal(decision.status, 'allowed')
	assert.equal(decision.reasonCodes.includes('AUTO_PERMISSION'), true)
})

test('requires idempotency key for side-effect tools', () => {
	const decision = evaluatePolicy({
		actor: baseActor,
		action: 'request.create_activation',
		resource: { requestType: 'chat' }
	})

	assert.equal(decision.status, 'denied')
	assert.equal(decision.reasonCodes.includes('IDEMPOTENCY_REQUIRED'), true)
})

test('blocks graph scraping style relationship search', () => {
	const decision = evaluatePolicy({
		actor: baseActor,
		action: 'relationship.search',
		context: { graphSearchBreadth: 100 }
	})

	assert.equal(decision.status, 'denied')
	assert.equal(decision.reasonCodes.includes('GRAPH_SCRAPING_RISK'), true)
})

test('validates agent request state transitions', () => {
	assert.equal(canTransitionAgentRequest('approval_required', 'approved'), true)
	assert.equal(canTransitionAgentRequest('approval_required', 'delivered'), false)
	assert.throws(
		() => assertAgentRequestTransition('closed', 'queued'),
		/Invalid agent_request state transition/
	)
})

test('redacts relationship views according to policy decision', () => {
	const decision = evaluatePolicy({
		actor: baseActor,
		action: 'relationship.get',
		context: { requestedSensitiveFields: true }
	})

	const view = redactRelationship(
		{
			relationshipId: 'rel_01JTESTTESTTESTTESTTEST01',
			displayName: 'Lin',
			publicSummary: 'Met at an AI event.',
			privateSummary: 'Private notes',
			trustLevel: 'weak',
			temperature: 0.4,
			contactChannels: { email: 'lin@example.com' },
			sourceDetail: 'Private CRM import row'
		},
		decision
	)

	assert.equal(view.summary, 'Met at an AI event.')
	assert.equal(view.contactChannels, undefined)
	assert.equal(view.hiddenFields.includes('hide_contact_channels'), true)
})

test('canonicalizes and fingerprints idempotency payloads', async () => {
	assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}')

	const first = await createRequestFingerprint({ b: 2, a: 1 })
	const second = await createRequestFingerprint({ a: 1, b: 2 })
	assert.equal(first, second)

	assertIdempotencyKey('intent-20260701-japan-hardware')
	const replay = resolveIdempotency(
		{ actorId: 'agt_test', key: 'abc', requestHash: first, response: { ok: true } },
		first
	)
	assert.deepEqual(replay, { replay: true, response: { ok: true } })
	assert.throws(
		() =>
			resolveIdempotency(
				{ actorId: 'agt_test', key: 'abc', requestHash: 'different', response: {} },
				first
			),
		/different request body/
	)
})

test('calculates relationship and match scores from the plan formulas', () => {
	assert.equal(
		calculateRelationshipTemperature({
			recencyScore: 1,
			interactionDepth: 0.8,
			mutuality: 0.5,
			permissionStrength: 0.6,
			positiveFeedback: 0.2
		}),
		0.71
	)

	assert.equal(
		calculateMatchScore({
			topicOverlap: 0.9,
			relationshipTemperature: 0.7,
			permissionFit: permissionFitScore('approval_required'),
			pathQuality: 0.6,
			freshness: 0.5,
			reciprocity: 0.4
		}),
		0.71
	)
})

test('signs and verifies webhook payloads with timestamp tolerance', async () => {
	const signed = await signWebhook({
		body: '{"event":"request.created"}',
		secret: 'whsec_test',
		timestampSeconds: 1782890000
	})

	assert.equal(signed.timestamp, '1782890000')
	assert.match(signed.signature, /^v1=/)

	assert.equal(
		await verifyWebhookSignature({
			body: '{"event":"request.created"}',
			secret: 'whsec_test',
			timestampHeader: signed.timestamp,
			signatureHeader: signed.signature,
			nowSeconds: 1782890010
		}),
		true
	)

	assert.equal(
		await verifyWebhookSignature({
			body: '{"event":"request.created"}',
			secret: 'whsec_test',
			timestampHeader: signed.timestamp,
			signatureHeader: signed.signature,
			nowSeconds: 1782891000
		}),
		false
	)
})

test('AlinkCoreError.from rehydrates errors degraded by a Workers RPC boundary', () => {
	// A real instance passes through untouched.
	const direct = new AlinkCoreError('QUOTA_EXCEEDED', 'limit reached', { retryable: true })
	assert.equal(AlinkCoreError.from(direct), direct)

	// workerd reconstructs a thrown AlinkCoreError as a plain Error with own
	// props (name, code, retryable) preserved but the prototype lost.
	const degraded = new Error('limit reached')
	degraded.name = 'AlinkCoreError'
	degraded.code = 'QUOTA_EXCEEDED'
	degraded.retryable = true
	assert.equal(degraded instanceof AlinkCoreError, false)
	const rehydrated = AlinkCoreError.from(degraded)
	assert.ok(rehydrated instanceof AlinkCoreError)
	assert.equal(rehydrated.code, 'QUOTA_EXCEEDED')
	assert.equal(rehydrated.message, 'limit reached')
	assert.equal(rehydrated.retryable, true)
	assert.equal(rehydrated.cause, degraded)

	// Anything else is not ours.
	assert.equal(AlinkCoreError.from(new Error('boom')), null)
	assert.equal(AlinkCoreError.from('boom'), null)
	const missingCode = new Error('no code')
	missingCode.name = 'AlinkCoreError'
	assert.equal(AlinkCoreError.from(missingCode), null)
})
