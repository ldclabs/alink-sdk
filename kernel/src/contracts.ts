/**
 * Contact Contract templates and the pure rule-layer evaluation that gates a
 * public request intake before any LLM triage (product doc §6.1/§6.3, §5).
 *
 * The five user-facing templates (§6.3) each map to a full default contract so
 * that a Free user can publish without touching any advanced field ("template
 * defaults must be self-consistent", §5.1 AC). Custom contracts (Plus+) start
 * from a template and override fields.
 */
import type {
	AgentPersona,
	ContactContract,
	ContactTemplateId,
	ContractConversation,
	IntakeRequestType,
	RequestIntake,
	TriageBand,
	TriageReason,
	TriageReasonCode
} from './types.js'

/** Sugar for the rule/heuristic layers, which only ever emit coded reasons. */
export function ruleReason(
	code: TriageReasonCode,
	params?: Record<string, string | number>
): TriageReason {
	return params ? { kind: 'code', code, params } : { kind: 'code', code }
}

/**
 * Decode one stored reason. Rows written before reasons became structured hold
 * bare strings; they decode to the passthrough variant so old intakes still
 * render (unlocalized, exactly as they do today). Unknown shapes are dropped.
 */
export function toTriageReason(raw: unknown): TriageReason | null {
	if (typeof raw === 'string') return { kind: 'text', text: raw }
	if (!raw || typeof raw !== 'object') return null
	const value = raw as Record<string, unknown>
	if (value.kind === 'code' && typeof value.code === 'string') {
		return {
			kind: 'code',
			code: value.code as TriageReasonCode,
			...(value.params && typeof value.params === 'object'
				? { params: value.params as Record<string, string | number> }
				: {})
		}
	}
	if (typeof value.text === 'string') return { kind: 'text', text: value.text }
	return null
}

/** Thread message caps (product doc §6.10) — async conversation, not a chat firehose. */
export const THREAD_MESSAGE_MAX_CHARS = 2_000
export const THREAD_MESSAGES_PER_DAY = 30
/** Absolute per-thread ceiling; past it the thread turns read-only. */
export const THREAD_MESSAGES_MAX = 500

// --- Visitor conversation (R1, product doc §5.1/§6.3/§8.5) -----------------

/** Visitor message ceiling per turn — letters, not a chat firehose. */
export const CONVERSE_MESSAGE_MAX_CHARS = 2_000
/** Bounds on the persona knobs (owner-authored public UGC). */
export const PERSONA_STYLE_MAX_CHARS = 200
export const PERSONA_SIGNATURE_MAX_CHARS = 120
export const PERSONA_MAX_LANGUAGES = 6

/**
 * Conversation defaults every template shares (§6.3): on, 10 turns per
 * visitor, plan-quota daily budget (0 = plan default), full disclosureFields.
 */
export const CONVERSATION_DEFAULTS: ContractConversation = {
	enabled: true,
	maxTurnsPerVisitor: 10,
	dailyBudget: 0,
	canAnswerAbout: [],
	visitorMemory: true
}

/**
 * The fields the assistant may talk about (§6.3): canAnswerAbout narrows
 * disclosureFields; empty means the full set. Intersection, so a field the
 * owner removed from disclosureFields can never come back via canAnswerAbout.
 */
export function effectiveCanAnswerAbout(
	contract: Pick<ContactContract, 'disclosureFields' | 'conversation'>
): readonly string[] {
	const narrowing = contract.conversation.canAnswerAbout
	if (narrowing.length === 0) return contract.disclosureFields
	const allowed = new Set(narrowing)
	return contract.disclosureFields.filter((field) => allowed.has(field))
}

/**
 * Red-line scan for persona text (§5.7 AI disclosure is not optional): the
 * persona must never instruct the assistant to pose as a human or hide that it
 * is an AI. The AI notice is appended outside the model regardless — this
 * validation exists so the owner cannot even *ask* for impersonation.
 */
// Heuristic, not the guarantee: the AI notice is appended OUTSIDE the model
// regardless (services/converse.ts), so a phrasing that slips past this regex
// still cannot ship an undisclosed-AI reply. Word-bounded so prose like
// "not an aircraft engineer" never trips it; en+zh only for v0.
const PERSONA_RED_LINES =
	/(pretend|pose|act)[^.\n]{0,40}\b(human|real person)\b|not\s+an?\s+(ai|bot|assistant)\b|(是|扮演|假装)[^。\n]{0,12}真人|(不是|并非|否认)[^。\n]{0,8}(ai\b|人工智能|机器人)/i

export function personaRedLineHit(persona: AgentPersona): boolean {
	const texts = [persona.style ?? '', persona.signatureLine ?? '']
	return texts.some((text) => PERSONA_RED_LINES.test(text))
}

export const INTAKE_REQUEST_TYPES: readonly IntakeRequestType[] = [
	'ask',
	'meeting',
	'intro',
	'collaboration',
	'media',
	'hiring',
	'pitch'
]

/** Field sets a template requires by request type (product doc §6.1). */
const PITCH_FIELDS = ['deckUrl', 'stage', 'traction', 'teamSize'] as const
const MEDIA_FIELDS = ['outlet', 'deadline', 'topic'] as const
const INTRO_FIELDS = ['targetPerson', 'reason', 'relationship'] as const
// Every built-in template that accepts meetings requires an agenda (booking
// doc §3.6 会前简报): the conversation asks for it, and each confirmed meeting
// arrives with its background dossier.
const MEETING_FIELDS = ['agenda'] as const

type TemplateDefaults = Omit<
	ContactContract,
	| 'id'
	| 'principalUserId'
	| 'version'
	| 'active'
	| 'effectiveFrom'
	| 'expiresAt'
	| 'createdAt'
	| 'updatedAt'
>

const BASE: TemplateDefaults = {
	templateId: 'custom',
	allowedRequestTypes: ['ask', 'meeting', 'intro', 'collaboration', 'media', 'hiring', 'pitch'],
	allowedTopics: [],
	blockedTopics: [],
	requiredContextFields: {
		pitch: [...PITCH_FIELDS],
		media: [...MEDIA_FIELDS],
		intro: [...INTRO_FIELDS],
		meeting: [...MEETING_FIELDS]
	},
	autoReply: { tone: 'neutral', autoDeclineEnabled: false },
	escalateAlways: ['intro'],
	responseSlaHours: 72,
	maxPerSenderDays: 7,
	disclosureFields: ['displayName', 'headline', 'allowedRequestTypes'],
	// Conversation is on by default for every template (§8.1: L1 must be in
	// Free — a link that cannot answer is dead); 'private' keeps it on too, the
	// assistant simply answers within a default-deny contract.
	conversation: CONVERSATION_DEFAULTS
}

/**
 * Per-template defaults (product doc §6.3). Every template is directly
 * publishable with no further configuration.
 */
export const CONTRACT_TEMPLATES: Record<Exclude<ContactTemplateId, 'custom'>, TemplateDefaults> = {
	// The registration default (§6.4): everyone is welcome, the assistant
	// engages proactively, only obvious spam is filtered, intents lead the card.
	// No request type escalates unconditionally and (beyond the B3 meeting
	// agenda) no context fields are demanded up front — the conversation
	// collects what is missing (§5.1).
	open: {
		...BASE,
		templateId: 'open',
		requiredContextFields: { meeting: [...MEETING_FIELDS] },
		autoReply: { tone: 'warm', autoDeclineEnabled: false },
		escalateAlways: [],
		responseSlaHours: 96,
		maxPerSenderDays: 7
	},
	investor: {
		...BASE,
		templateId: 'investor',
		allowedRequestTypes: ['pitch', 'intro', 'meeting', 'ask'],
		requiredContextFields: {
			pitch: [...PITCH_FIELDS],
			intro: [...INTRO_FIELDS],
			meeting: [...MEETING_FIELDS]
		},
		escalateAlways: ['intro'],
		responseSlaHours: 72
	},
	founder: {
		...BASE,
		templateId: 'founder',
		allowedRequestTypes: ['hiring', 'media', 'pitch', 'intro', 'meeting', 'ask'],
		blockedTopics: ['sales', 'cold outreach'],
		requiredContextFields: {
			pitch: [...PITCH_FIELDS],
			media: [...MEDIA_FIELDS],
			intro: [...INTRO_FIELDS],
			hiring: ['role', 'resumeUrl'],
			meeting: [...MEETING_FIELDS]
		},
		escalateAlways: ['intro'],
		responseSlaHours: 96
	},
	open_office_hours: {
		...BASE,
		templateId: 'open_office_hours',
		allowedRequestTypes: ['ask', 'meeting'],
		autoReply: { tone: 'warm', autoDeclineEnabled: false },
		responseSlaHours: 168,
		maxPerSenderDays: 30
	},
	private: {
		...BASE,
		templateId: 'private',
		// Default-deny: only whitelisted topics or trusted intros reach a human.
		allowedRequestTypes: ['ask', 'intro'],
		escalateAlways: ['ask', 'intro', 'meeting', 'collaboration', 'media', 'hiring', 'pitch'],
		autoReply: { tone: 'formal', autoDeclineEnabled: false },
		responseSlaHours: 168,
		maxPerSenderDays: 1
	},
	event: {
		...BASE,
		templateId: 'event',
		allowedRequestTypes: ['meeting', 'collaboration', 'ask', 'intro'],
		autoReply: { tone: 'warm', autoDeclineEnabled: false },
		responseSlaHours: 72,
		maxPerSenderDays: 3
	}
}

/** Build a full default contract body for a template (fields the caller fills in separately). */
export function contractDefaultsFor(templateId: ContactTemplateId): TemplateDefaults {
	if (templateId === 'custom') return { ...BASE }
	return { ...CONTRACT_TEMPLATES[templateId] }
}

export interface IntakeRuleInput {
	requestType: IntakeRequestType
	topics: readonly string[]
	/** Keys present in the submitted context object. */
	providedContextFields: readonly string[]
	/** Prior intakes from the same verified sender within maxPerSenderDays. */
	recentFromSender: number
	/** True when the honeypot field was filled — a bot signal. */
	honeypotTripped: boolean
}

export interface IntakeRuleOutcome {
	/** 'reject' short-circuits before any LLM spend; 'escalate' forces human review. */
	action: 'accept' | 'need_context' | 'escalate' | 'reject'
	band: TriageBand
	reasons: TriageReason[]
	missingFields: string[]
}

/**
 * Deterministic rule layer (product doc §5, §13.4): runs before any LLM triage
 * so honeypot hits, blocked types/topics, over-frequency, and missing required
 * context never cost a model call.
 */
export function evaluateIntakeRules(
	contract: ContactContract,
	input: IntakeRuleInput
): IntakeRuleOutcome {
	const reasons: TriageReason[] = []

	if (input.honeypotTripped) {
		return {
			action: 'reject',
			band: 'auto_declined',
			reasons: [ruleReason('honeypot')],
			missingFields: []
		}
	}

	if (!contract.allowedRequestTypes.includes(input.requestType)) {
		return {
			action: 'reject',
			band: 'auto_declined',
			reasons: [ruleReason('request_type_not_accepted', { type: input.requestType })],
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

	const required = contract.requiredContextFields[input.requestType] ?? []
	const provided = new Set(input.providedContextFields)
	const missingFields = required.filter((field) => !provided.has(field))
	if (missingFields.length > 0) {
		return {
			action: 'need_context',
			band: 'needs_more_context',
			reasons: [ruleReason('missing_context', { fields: missingFields.join(', ') })],
			missingFields
		}
	}

	if (contract.allowedTopics.length > 0) {
		const allowed = new Set(contract.allowedTopics.map((t) => t.trim().toLowerCase()))
		const anyAllowed = input.topics.some((t) => allowed.has(t.trim().toLowerCase()))
		if (!anyAllowed) reasons.push(ruleReason('no_topic_overlap'))
	}

	if (contract.escalateAlways.includes(input.requestType)) {
		return {
			action: 'escalate',
			band: 'needs_review',
			reasons: [...reasons, ruleReason('always_escalates', { type: input.requestType })],
			missingFields: []
		}
	}

	return { action: 'accept', band: 'suggested_allow', reasons, missingFields: [] }
}

/** Whether an intake's declared context satisfies the contract (used by tests/UI). */
export function intakeContextComplete(
	contract: ContactContract,
	intake: Pick<RequestIntake, 'requestType'>,
	providedContextFields: readonly string[]
): boolean {
	const required = contract.requiredContextFields[intake.requestType] ?? []
	const provided = new Set(providedContextFields)
	return required.every((field) => provided.has(field))
}
