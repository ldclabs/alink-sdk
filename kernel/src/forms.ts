/**
 * Intent Forms domain (docs/alink-intent-forms.md): the pure vocabulary for
 * 「意图表单」— a structured application spec embedded in ONE intent (DP-F-1:
 * a form is never a first-class object; the intent's visibility clamp, expiry
 * and MCP surface are its visibility clamp, expiry and surface).
 *
 * Three invariants anchor everything here (doc §1.3, locked by tests):
 * · INV-F-1 — the field-type vocabulary is CLOSED (the seven below) and never
 *   contains password/masked, payment, or file inputs; every authored string
 *   is length-capped and rendered as plain text.
 * · INV-F-2 — every form submission IS a gatekeeper intake: rule-layer
 *   anti-abuse (honeypot / frequency / blockedTopics) runs unexempted, and no
 *   anonymous-survey side channel exists.
 * · INV-F-3 — form submissions always land in the human queue (band capped at
 *   needs_review; auto-offer and every other automated release excludes them).
 */
import { AlinkCoreError } from './errors.js'
import type { ContactContract, IntakeRequestType, JsonValue } from './types.js'
import { INTAKE_REQUEST_TYPES, ruleReason, type IntakeRuleOutcome } from './contracts.js'

// ---------------------------------------------------------------------------
// Vocabulary + limits

/** INV-F-1: the closed field-type vocabulary. Extending it is a red-flag
 * review (doc §1.3) — password/payment/file classes are banned forever. */
export const INTENT_FORM_FIELD_TYPES = [
	'text',
	'textarea',
	'select',
	'multiselect',
	'url',
	'number',
	'boolean'
] as const
export type IntentFormFieldType = (typeof INTENT_FORM_FIELD_TYPES)[number]

export const INTENT_FORM_LIMITS = {
	maxFields: 12,
	keyPattern: /^[a-z][a-z0-9_]{0,31}$/,
	labelMaxChars: 60,
	descriptionMaxChars: 200,
	ctaMaxChars: 30,
	introMaxChars: 500,
	optionMaxChars: 60,
	optionsMin: 2,
	optionsMax: 12,
	/** Per-answer ceiling for text fields; defaults below. */
	answerMaxChars: 2_000,
	textDefaultMaxChars: 200,
	textareaDefaultMaxChars: 2_000,
	urlMaxChars: 500,
	/** Serialized form_json ceiling (doc §4.1). */
	specMaxJsonChars: 4_096
} as const

/**
 * Keys the requester identity block already owns (doc §4.1 保留键黑名单):
 * a form must never re-collect them — data minimization plus inbox-field
 * clarity. `_`-prefixed keys are reserved for future protocol use.
 */
export const INTENT_FORM_RESERVED_KEYS: readonly string[] = [
	'name',
	'org',
	'role',
	'email',
	'replyemail',
	'reply_email',
	'verifiablelink',
	'verifiable_link',
	'subject',
	'body'
]

export interface IntentFormField {
	key: string
	label: string
	description?: string
	type: IntentFormFieldType
	required: boolean
	/** select/multiselect only. */
	options?: readonly string[]
	/** text/textarea only; defaults per type. */
	maxChars?: number
}

/** The stored spec (intents.form_json). `version` is stamped by the DO write
 * path (edit ⇒ +1); submissions pin it alongside a field snapshot. */
export interface IntentForm {
	version: number
	requestType: IntakeRequestType
	cta?: string
	intro?: string
	fields: readonly IntentFormField[]
}

/** The authoring shape (MCP / v1): everything but the server-owned version. */
export type IntentFormInput = Omit<IntentForm, 'version'>

/**
 * The per-submission spec snapshot (request_intakes.form_snapshot_cipher):
 * exactly what the inbox needs to render answers faithfully after any later
 * spec edit — never re-read from the live intent row (doc §4.2).
 */
export interface IntentFormSnapshot {
	intentId: string
	intentTitle: string
	version: number
	requestType: IntakeRequestType
	fields: readonly IntentFormField[]
}

function fail(message: string): never {
	throw new AlinkCoreError('VALIDATION_FAILED', message)
}

// ---------------------------------------------------------------------------
// Spec validation (authoring side)

/**
 * Validate + normalize an authored form spec (doc §6.1). Returns a cleaned
 * copy (trimmed strings, dropped empty optionals) — never the caller's object.
 * Throws VALIDATION_FAILED with a field-precise message; the assistant relays
 * it verbatim, so每一条都要能被人读懂.
 */
export function validateIntentFormInput(input: IntentFormInput): IntentFormInput {
	if (!INTAKE_REQUEST_TYPES.includes(input.requestType)) {
		fail(`form.requestType must be one of: ${INTAKE_REQUEST_TYPES.join(', ')}`)
	}
	const cta = input.cta?.trim()
	if (cta !== undefined && (cta.length === 0 || cta.length > INTENT_FORM_LIMITS.ctaMaxChars)) {
		fail(`form.cta must be 1-${INTENT_FORM_LIMITS.ctaMaxChars} characters`)
	}
	const intro = input.intro?.trim()
	if (intro !== undefined && intro.length > INTENT_FORM_LIMITS.introMaxChars) {
		fail(`form.intro must be at most ${INTENT_FORM_LIMITS.introMaxChars} characters`)
	}
	if (
		!Array.isArray(input.fields) ||
		input.fields.length === 0 ||
		input.fields.length > INTENT_FORM_LIMITS.maxFields
	) {
		fail(`form.fields must contain 1-${INTENT_FORM_LIMITS.maxFields} fields`)
	}
	const seen = new Set<string>()
	const fields = input.fields.map((field) => validateFormField(field, seen))
	const cleaned: IntentFormInput = {
		requestType: input.requestType,
		...(cta ? { cta } : {}),
		...(intro ? { intro } : {}),
		fields
	}
	if (JSON.stringify(cleaned).length > INTENT_FORM_LIMITS.specMaxJsonChars) {
		fail(`form must serialize to at most ${INTENT_FORM_LIMITS.specMaxJsonChars} characters`)
	}
	return cleaned
}

function validateFormField(field: IntentFormField, seen: Set<string>): IntentFormField {
	if (!INTENT_FORM_LIMITS.keyPattern.test(field.key)) {
		fail(`form field key '${field.key}' must match ${INTENT_FORM_LIMITS.keyPattern}`)
	}
	if (INTENT_FORM_RESERVED_KEYS.includes(field.key)) {
		fail(`form field key '${field.key}' is reserved (the requester block already collects it)`)
	}
	if (seen.has(field.key)) fail(`form field key '${field.key}' is duplicated`)
	seen.add(field.key)

	if (!INTENT_FORM_FIELD_TYPES.includes(field.type)) {
		fail(`form field '${field.key}' has unknown type '${field.type}'`)
	}
	const label = field.label?.trim()
	if (!label || label.length > INTENT_FORM_LIMITS.labelMaxChars) {
		fail(
			`form field '${field.key}' needs a label of 1-${INTENT_FORM_LIMITS.labelMaxChars} characters`
		)
	}
	const description = field.description?.trim()
	if (description !== undefined && description.length > INTENT_FORM_LIMITS.descriptionMaxChars) {
		fail(
			`form field '${field.key}' description must be at most ${INTENT_FORM_LIMITS.descriptionMaxChars} characters`
		)
	}

	const selectish = field.type === 'select' || field.type === 'multiselect'
	if (selectish) {
		const options = (field.options ?? []).map((option) => option.trim())
		if (
			options.length < INTENT_FORM_LIMITS.optionsMin ||
			options.length > INTENT_FORM_LIMITS.optionsMax ||
			options.some((o) => o.length === 0 || o.length > INTENT_FORM_LIMITS.optionMaxChars) ||
			new Set(options).size !== options.length
		) {
			fail(
				`form field '${field.key}' needs ${INTENT_FORM_LIMITS.optionsMin}-${INTENT_FORM_LIMITS.optionsMax} distinct options of at most ${INTENT_FORM_LIMITS.optionMaxChars} characters each`
			)
		}
		return {
			key: field.key,
			label,
			...(description ? { description } : {}),
			type: field.type,
			required: field.required === true,
			options
		}
	}
	if (field.options !== undefined) {
		fail(`form field '${field.key}' of type '${field.type}' must not declare options`)
	}

	let maxChars: number | undefined
	if (field.type === 'text' || field.type === 'textarea') {
		const fallback =
			field.type === 'text'
				? INTENT_FORM_LIMITS.textDefaultMaxChars
				: INTENT_FORM_LIMITS.textareaDefaultMaxChars
		maxChars = field.maxChars ?? fallback
		if (
			!Number.isInteger(maxChars) ||
			maxChars < 1 ||
			maxChars > INTENT_FORM_LIMITS.answerMaxChars
		) {
			fail(
				`form field '${field.key}' maxChars must be an integer of 1-${INTENT_FORM_LIMITS.answerMaxChars}`
			)
		}
	} else if (field.maxChars !== undefined) {
		fail(`form field '${field.key}' of type '${field.type}' must not declare maxChars`)
	}

	return {
		key: field.key,
		label,
		...(description ? { description } : {}),
		type: field.type,
		required: field.required === true,
		...(maxChars !== undefined ? { maxChars } : {})
	}
}

/**
 * Compose the live IntentForm from its two columns: form_json holds the
 * VERSIONLESS spec (marshalFormInput output), form_version is the DO-stamped
 * monotonic counter — the single version authority (it survives removal so a
 * re-added form can never reuse a pinned snapshot version). A corrupt column
 * yields null (the row simply has no form) rather than sinking the read —
 * the write path is the only author, so corruption here is a bug, not input.
 */
export function parseIntentForm(
	formJson: string | null | undefined,
	formVersion?: number | null
): IntentForm | null {
	if (!formJson) return null
	try {
		const value = JSON.parse(formJson) as Omit<IntentForm, 'version'>
		if (!value || typeof value !== 'object' || !Array.isArray(value.fields)) return null
		return { ...value, version: Number(formVersion ?? 1) }
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// Rule layer (submission side, DP-F-3)

/**
 * The form-tailored rule layer (doc §5.2 step 5): anti-abuse runs unexempted
 * (INV-F-2 — honeypot, per-sender frequency, blocked topics), while the two
 * contract gates a form replaces are skipped — `allowedRequestTypes` (the
 * form's existence IS the acceptance declaration) and per-type
 * `requiredContextFields` (the form's own required fields were strictly
 * 422-validated before this runs). Everything that survives escalates:
 * form submissions always land in the human queue (INV-F-3).
 */
export function evaluateFormIntakeRules(
	contract: Pick<ContactContract, 'blockedTopics' | 'maxPerSenderDays'>,
	input: {
		topics: readonly string[]
		/** Prior intakes from the same sender within maxPerSenderDays. */
		recentFromSender: number
		honeypotTripped: boolean
	}
): IntakeRuleOutcome {
	if (input.honeypotTripped) {
		return {
			action: 'reject',
			band: 'auto_declined',
			reasons: [ruleReason('honeypot')],
			missingFields: []
		}
	}
	const blocked = new Set(contract.blockedTopics.map((t) => t.trim().toLowerCase()))
	const hitBlocked = input.topics.find((t) => blocked.has(t.trim().toLowerCase()))
	if (hitBlocked) {
		return {
			action: 'reject',
			band: 'auto_declined',
			reasons: [ruleReason('topic_blocked', { topic: hitBlocked })],
			missingFields: []
		}
	}
	if (input.recentFromSender >= contract.maxPerSenderDays) {
		return {
			action: 'reject',
			band: 'auto_declined',
			reasons: [ruleReason('frequency_limit')],
			missingFields: []
		}
	}
	return {
		action: 'escalate',
		band: 'needs_review',
		reasons: [ruleReason('form_submission')],
		missingFields: []
	}
}

// ---------------------------------------------------------------------------
// Answer validation (submission side)

/**
 * Validate a visitor's answers against the pinned spec (doc §5.2 step 3):
 * strict — unknown keys reject, required fields must be present and
 * non-empty, every value must match its field type. Returns the cleaned
 * answers object (the intake's `context`). Field-level failures are 422s the
 * visitor can fix; nothing here is an anti-abuse verdict.
 */
export function validateFormAnswers(
	form: Pick<IntentForm, 'fields'>,
	answers: Record<string, unknown>
): Record<string, JsonValue> {
	const byKey = new Map(form.fields.map((field) => [field.key, field]))
	for (const key of Object.keys(answers)) {
		if (!byKey.has(key)) fail(`unknown form field '${key}'`)
	}
	const cleaned: Record<string, JsonValue> = {}
	for (const field of form.fields) {
		const raw = answers[field.key]
		const value = validateAnswer(field, raw)
		if (value === undefined) {
			if (field.required) fail(`'${field.label}' is required`)
			continue
		}
		cleaned[field.key] = value
	}
	return cleaned
}

/** One field's answer, normalized — or undefined when absent/empty. */
function validateAnswer(field: IntentFormField, raw: unknown): JsonValue | undefined {
	if (raw === undefined || raw === null) return undefined
	switch (field.type) {
		case 'text':
		case 'textarea': {
			if (typeof raw !== 'string') fail(`'${field.label}' must be text`)
			const value = raw.trim()
			if (value.length === 0) return undefined
			const cap = field.maxChars ?? INTENT_FORM_LIMITS.answerMaxChars
			if (value.length > cap) fail(`'${field.label}' must be at most ${cap} characters`)
			return value
		}
		case 'url': {
			if (typeof raw !== 'string') fail(`'${field.label}' must be a URL`)
			const value = raw.trim()
			if (value.length === 0) return undefined
			if (value.length > INTENT_FORM_LIMITS.urlMaxChars) {
				fail(`'${field.label}' must be at most ${INTENT_FORM_LIMITS.urlMaxChars} characters`)
			}
			let parsed: URL
			try {
				parsed = new URL(value)
			} catch {
				fail(`'${field.label}' must be a valid URL`)
			}
			if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
				fail(`'${field.label}' must be an http(s) URL`)
			}
			return value
		}
		case 'select': {
			if (typeof raw !== 'string') fail(`'${field.label}' must be one of its options`)
			if (raw.length === 0) return undefined
			if (!field.options?.includes(raw)) fail(`'${field.label}' must be one of its options`)
			return raw
		}
		case 'multiselect': {
			if (!Array.isArray(raw)) fail(`'${field.label}' must be a list of its options`)
			if (raw.length === 0) return undefined
			const options = field.options ?? []
			const values = raw.map((item) => {
				if (typeof item !== 'string' || !options.includes(item)) {
					fail(`'${field.label}' must only contain its options`)
				}
				return item
			})
			if (new Set(values).size !== values.length) {
				fail(`'${field.label}' must not repeat options`)
			}
			return values
		}
		case 'number': {
			const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				fail(`'${field.label}' must be a number`)
			}
			return value
		}
		case 'boolean': {
			if (typeof raw !== 'boolean') fail(`'${field.label}' must be true or false`)
			// An unchecked optional checkbox is an absent answer, not a stored
			// `false` — required means "must be checked" (consent-style).
			if (!raw) {
				if (field.required) fail(`'${field.label}' must be checked`)
				return undefined
			}
			return true
		}
	}
}
