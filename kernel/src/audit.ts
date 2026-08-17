import { canonicalJson } from './idempotency.js'
import { makeId } from './ids.js'
import type { AuditEvent, AuditEventInput } from './types.js'

export function createAuditEvent(input: AuditEventInput): AuditEvent {
	const event: AuditEvent = {
		id: makeId('audit'),
		traceId: input.traceId,
		actorType: input.actorType,
		action: input.action,
		createdAt: input.createdAt ?? Date.now()
	}

	if (input.actorId) event.actorId = input.actorId
	if (input.resourceType) event.resourceType = input.resourceType
	if (input.resourceId) event.resourceId = input.resourceId
	if (input.decision) event.decision = input.decision
	if (input.ipHash) event.ipHash = input.ipHash
	if (input.userAgentHash) event.userAgentHash = input.userAgentHash
	if (input.detailR2Key) event.detailR2Key = input.detailR2Key

	return event
}

/**
 * Content hash for the per-user audit hash-chain (product doc §12.6). Chains the
 * previous event's hash so any retroactive edit or deletion breaks verification.
 * base64url(SHA-256(canonical({ ...identifying fields, prevHash }))).
 */
export async function computeAuditEventHash(
	event: Pick<
		AuditEvent,
		| 'id'
		| 'traceId'
		| 'actorType'
		| 'actorId'
		| 'action'
		| 'resourceType'
		| 'resourceId'
		| 'decision'
		| 'detailR2Key'
		| 'createdAt'
		| 'chainSeq'
	>,
	prevHash: string
): Promise<string> {
	const material = canonicalJson({
		id: event.id,
		traceId: event.traceId,
		actorType: event.actorType,
		actorId: event.actorId ?? null,
		action: event.action,
		resourceType: event.resourceType ?? null,
		resourceId: event.resourceId ?? null,
		decision: event.decision ?? null,
		detailR2Key: event.detailR2Key ?? null,
		createdAt: event.createdAt,
		chainSeq: event.chainSeq ?? 0,
		prevHash
	})
	const digest = await getSubtle().digest('SHA-256', new TextEncoder().encode(material))
	return base64Url(new Uint8Array(digest))
}

function base64Url(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function getSubtle(): SubtleCrypto {
	const subtle = crypto?.subtle
	if (!subtle) throw new Error('crypto.subtle is required')
	return subtle
}
