import type { PolicyDecision, Redaction, ToolAction, TrustLevel } from './types.js'

export interface RelationshipViewInput {
	relationshipId: string
	displayName: string
	publicSummary?: string
	privateSummary?: string
	trustLevel: TrustLevel
	temperature: number
	topics?: readonly string[]
	contactChannels?: {
		email?: string
		phone?: string
		handle?: string
	}
	sourceDetail?: string
}

export interface RedactedRelationshipView {
	relationshipId: string
	displayName: string
	summary: string
	trustLevel: TrustLevel
	temperature: number
	topics: readonly string[]
	allowedActions: readonly ToolAction[]
	hiddenFields: readonly Redaction[]
	contactChannels?: {
		email?: string
		phone?: string
		handle?: string
	}
	sourceDetail?: string
}

export interface RedactionOptions {
	/** Placeholder shown when the display name is hidden. */
	redactedNameLabel?: string
}

export function redactRelationship(
	relationship: RelationshipViewInput,
	decision: PolicyDecision,
	options: RedactionOptions = {}
): RedactedRelationshipView {
	const hidden = new Set(decision.redactions)
	// The private summary may only fall back into `summary` when neither the
	// sensitive-summary nor the private-note redaction is in force; otherwise the
	// redaction metadata (hiddenFields) would claim a hidden field we still leak.
	const summary =
		hidden.has('hide_sensitive_summary') || hidden.has('hide_private_note')
			? (relationship.publicSummary ?? '')
			: (relationship.publicSummary ?? relationship.privateSummary ?? '')

	const view: RedactedRelationshipView = {
		relationshipId: relationship.relationshipId,
		displayName: hidden.has('hide_name')
			? (options.redactedNameLabel ?? 'A contact')
			: relationship.displayName,
		summary,
		trustLevel: relationship.trustLevel,
		temperature: relationship.temperature,
		topics: relationship.topics ?? [],
		allowedActions: decision.allowedActions,
		hiddenFields: decision.redactions
	}

	const contactChannels = redactContactChannels(relationship.contactChannels, hidden)
	if (contactChannels) {
		view.contactChannels = contactChannels
	}

	if (relationship.sourceDetail && !hidden.has('hide_source_detail')) {
		view.sourceDetail = relationship.sourceDetail
	}

	return view
}

function redactContactChannels(
	channels: RelationshipViewInput['contactChannels'],
	hidden: ReadonlySet<Redaction>
): RelationshipViewInput['contactChannels'] | undefined {
	if (!channels || hidden.has('hide_contact_channels')) return undefined

	const output: NonNullable<RelationshipViewInput['contactChannels']> = {}
	if (channels.email && !hidden.has('hide_email')) output.email = channels.email
	if (channels.phone && !hidden.has('hide_phone_number')) output.phone = channels.phone
	if (channels.handle) output.handle = channels.handle

	return Object.keys(output).length > 0 ? output : undefined
}
