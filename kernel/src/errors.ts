export class AlinkCoreError extends Error {
	readonly code: string
	readonly retryable: boolean

	constructor(
		code: string,
		message: string,
		options: { retryable?: boolean; cause?: unknown } = {}
	) {
		super(message, { cause: options.cause })
		this.name = 'AlinkCoreError'
		this.code = code
		this.retryable = options.retryable ?? false
	}

	/**
	 * Recognize an AlinkCoreError that may have crossed a Workers RPC boundary
	 * (e.g. thrown inside a Durable Object method). workerd reconstructs such
	 * errors as plain `Error`s: own properties (`code`, `retryable`) survive,
	 * but the prototype does not, so `instanceof AlinkCoreError` is false on
	 * the caller side and the error would be misclassified as INTERNAL. Any
	 * code that classifies errors which may come from an RPC stub must use
	 * this instead of a bare `instanceof` check.
	 */
	static from(error: unknown): AlinkCoreError | null {
		if (error instanceof AlinkCoreError) return error
		if (error instanceof Error && error.name === 'AlinkCoreError') {
			const { code, retryable } = error as Error & { code?: unknown; retryable?: unknown }
			if (typeof code === 'string') {
				return new AlinkCoreError(code, error.message, {
					retryable: retryable === true,
					cause: error
				})
			}
		}
		return null
	}
}
