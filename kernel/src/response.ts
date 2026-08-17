import { makeTraceId } from './ids.js'
import type {
	CoreEnvelope,
	ErrorEnvelope,
	JsonValue,
	PolicyDecision,
	SuccessEnvelope
} from './types.js'

export interface SuccessOptions {
	traceId?: string
	decision?: PolicyDecision
	warnings?: readonly string[]
	nextActions?: readonly JsonValue[]
}

export interface ErrorOptions {
	traceId?: string
	code: string
	message: string
	retryable?: boolean
}

export function ok<TData>(data: TData, options: SuccessOptions = {}): SuccessEnvelope<TData> {
	const response: SuccessEnvelope<TData> = {
		ok: true,
		traceId: options.traceId ?? makeTraceId(),
		data,
		warnings: options.warnings ?? [],
		nextActions: options.nextActions ?? []
	}

	if (options.decision) {
		response.decision = options.decision
	}

	return response
}

export function fail(options: ErrorOptions): ErrorEnvelope {
	return {
		ok: false,
		traceId: options.traceId ?? makeTraceId(),
		error: {
			code: options.code,
			message: options.message,
			retryable: options.retryable ?? false
		}
	}
}

export function isOk<TData>(envelope: CoreEnvelope<TData>): envelope is SuccessEnvelope<TData> {
	return envelope.ok
}
