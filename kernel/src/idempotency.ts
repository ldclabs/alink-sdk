import { AlinkCoreError } from './errors.js'

export interface IdempotencyRecord<TResponse = unknown> {
	actorId: string
	key: string
	requestHash: string
	response: TResponse
}

export interface IdempotencyReplay<TResponse> {
	replay: true
	response: TResponse
}

export function assertIdempotencyKey(key: string): void {
	if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
		throw new AlinkCoreError(
			'INVALID_IDEMPOTENCY_KEY',
			'Idempotency key must be 8-160 characters and contain only letters, numbers, dot, underscore, colon, or hyphen.'
		)
	}
}

export async function createRequestFingerprint(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalJson(value))
	const digest = await getCrypto().subtle.digest('SHA-256', bytes)
	return base64Url(new Uint8Array(digest))
}

export function resolveIdempotency<TResponse>(
	existing: IdempotencyRecord<TResponse> | null | undefined,
	requestHash: string
): IdempotencyReplay<TResponse> | null {
	if (!existing) return null

	if (existing.requestHash !== requestHash) {
		throw new AlinkCoreError(
			'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
			'The idempotency key was already used with a different request body.'
		)
	}

	return {
		replay: true,
		response: existing.response
	}
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(normalize(value))
}

function normalize(value: unknown): unknown {
	if (value === null) return null
	if (Array.isArray(value)) return value.map(normalize)

	if (typeof value === 'object') {
		const record = value as Record<string, unknown>
		const output: Record<string, unknown> = {}
		for (const key of Object.keys(record).sort()) {
			const normalized = normalize(record[key])
			if (normalized !== undefined) {
				output[key] = normalized
			}
		}

		return output
	}

	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value
	}

	if (value === undefined) return undefined

	throw new AlinkCoreError(
		'UNSUPPORTED_JSON_VALUE',
		`Cannot canonicalize value of type ${typeof value}`
	)
}

function base64Url(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}

	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function getCrypto(): Crypto {
	const cryptoApi = crypto
	if (!cryptoApi?.subtle) {
		throw new Error('crypto.subtle is required')
	}

	return cryptoApi
}
