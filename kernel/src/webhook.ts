import { AlinkCoreError } from './errors.js'

export interface WebhookSignatureInput {
	body: string | Uint8Array | ArrayBuffer
	secret: string | Uint8Array
	timestampSeconds?: number
}

export interface WebhookVerificationInput extends WebhookSignatureInput {
	timestampHeader: string
	signatureHeader: string
	nowSeconds?: number
	toleranceSeconds?: number
}

export interface WebhookSignature {
	timestamp: string
	signature: string
}

const DEFAULT_TOLERANCE_SECONDS = 300

export async function signWebhook(input: WebhookSignatureInput): Promise<WebhookSignature> {
	const timestamp = String(input.timestampSeconds ?? Math.floor(Date.now() / 1000))
	const signature = await computeWebhookSignature(input.secret, timestamp, input.body)

	return {
		timestamp,
		signature: `v1=${signature}`
	}
}

export async function verifyWebhookSignature(input: WebhookVerificationInput): Promise<boolean> {
	const timestamp = parseTimestamp(input.timestampHeader)
	const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
	const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS

	if (Math.abs(now - timestamp) > tolerance) {
		return false
	}

	const provided = parseSignatureHeader(input.signatureHeader)
	const expected = await computeWebhookSignature(input.secret, input.timestampHeader, input.body)
	return timingSafeEqual(base64UrlDecode(provided), base64UrlDecode(expected))
}

export function assertWebhookSignature(input: WebhookVerificationInput): Promise<void> {
	return verifyWebhookSignature(input).then((valid) => {
		if (!valid) {
			throw new AlinkCoreError(
				'WEBHOOK_SIGNATURE_INVALID',
				'Webhook signature is invalid or expired.'
			)
		}
	})
}

async function computeWebhookSignature(
	secret: string | Uint8Array,
	timestamp: string,
	body: string | Uint8Array | ArrayBuffer
): Promise<string> {
	const key = await getCrypto().subtle.importKey(
		'raw',
		toBytes(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	)
	const signedPayload = concatBytes(new TextEncoder().encode(`${timestamp}.`), toBytes(body))
	const signature = await getCrypto().subtle.sign('HMAC', key, signedPayload)

	return base64UrlEncode(new Uint8Array(signature))
}

function parseTimestamp(header: string): number {
	if (!/^\d{10,}$/.test(header)) {
		throw new AlinkCoreError('WEBHOOK_TIMESTAMP_INVALID', 'Webhook timestamp is malformed.')
	}

	const timestamp = Number(header)
	if (!Number.isSafeInteger(timestamp)) {
		throw new AlinkCoreError('WEBHOOK_TIMESTAMP_INVALID', 'Webhook timestamp is out of range.')
	}

	return timestamp
}

function parseSignatureHeader(header: string): string {
	const signatures = header
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)

	const v1 = signatures.find((part) => part.startsWith('v1='))
	if (!v1) {
		throw new AlinkCoreError(
			'WEBHOOK_SIGNATURE_MISSING',
			'Webhook signature header does not contain a v1 signature.'
		)
	}

	return v1.slice(3)
}

function toBytes(value: string | Uint8Array | ArrayBuffer): Uint8Array<ArrayBuffer> {
	if (typeof value === 'string') {
		return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>
	}
	if (value instanceof Uint8Array) return new Uint8Array(value)
	return new Uint8Array(value)
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(left.byteLength + right.byteLength)
	output.set(left, 0)
	output.set(right, left.byteLength)
	return output
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}

	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlDecode(value: string): Uint8Array {
	const padded = value
		.replaceAll('-', '+')
		.replaceAll('_', '/')
		.padEnd(Math.ceil(value.length / 4) * 4, '=')
	const binary = atob(padded)
	const bytes = new Uint8Array(binary.length)
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index)
	}

	return bytes
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
	const maxLength = Math.max(left.byteLength, right.byteLength)
	let diff = left.byteLength ^ right.byteLength

	for (let index = 0; index < maxLength; index += 1) {
		diff |= (left[index] ?? 0) ^ (right[index] ?? 0)
	}

	return diff === 0
}

function getCrypto(): Crypto {
	const cryptoApi = crypto
	if (!cryptoApi?.subtle) {
		throw new Error('crypto.subtle is required')
	}

	return cryptoApi
}
