import type { JsonValue } from './types.js'

export const AGENT_DID_PREFIX = 'did:agent:'

export type AgentDid = `did:agent:${string}`

export const AGENT_PROTOCOL_IDS = [
	'agent-identity/1.0',
	'agent-profile/1.0',
	'agent-delegation/1.0'
] as const

export type AgentProtocolId = (typeof AGENT_PROTOCOL_IDS)[number]

const AGENT_DID_SUFFIX_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function isAgentDid(value: string): value is AgentDid {
	if (!value.startsWith(AGENT_DID_PREFIX)) return false
	return AGENT_DID_SUFFIX_PATTERN.test(value.slice(AGENT_DID_PREFIX.length))
}

export interface SignedEvent<TPayload = JsonValue> {
	protocol: string
	type: string
	actor: AgentDid
	created_at: number
	nonce: number
	payload: TPayload
}

export interface SignedEventEnvelope<TPayload = JsonValue> {
	hash: string
	event: SignedEvent<TPayload>
	signature: string
}

export const LINK_RELS = ['homepage', 'documentation', 'source_code', 'social', 'browser'] as const

export type LinkRel = (typeof LINK_RELS)[number]

/**
 * The card's accent (card-page v2 §10.2) — a CLOSED six-tone set drawn from the
 * design system, never a free colour field.
 *
 * `DESIGN.md` is "cold surface, one warm point — Ember is the only warm colour
 * on any layout". A hex field hands every owner the ability to break that, and
 * the network stops looking like one product by the end of the week. Six tokens
 * still let a journalist's card be ink, a conservation org's moss and a fire
 * desk's rust, while the page remains recognisably alink.
 *
 * Server-side it is validated, not interpreted: the accent never reaches a
 * prompt, a policy decision or an email — it is presentation the card page
 * resolves. Anything unknown folds back to the client default rather than
 * failing a publish, because a colour is never worth rejecting a card over.
 */
export const CARD_ACCENTS = ['ink', 'moss', 'steel', 'amber', 'rust', 'flame'] as const

export type CardAccent = (typeof CARD_ACCENTS)[number]

export function isCardAccent(value: unknown): value is CardAccent {
	return typeof value === 'string' && (CARD_ACCENTS as readonly string[]).includes(value)
}

/**
 * 名片足迹的两个上限 (card-page v2 §11.6) — the grove footprints' numbers
 * verbatim (VISITED_GROVES_CAP / VISITED_PINNED_CAP). Same numbers on purpose:
 * the two are one address book with two doors, and a reader who learns the
 * shelf holds 60 should not find out that the other half holds something else.
 */
export const VISITED_CARDS_CAP = 60
export const VISITED_CARDS_PINNED_CAP = 12

/**
 * 记住的组织 (collaboration §41.3).
 *
 * Deliberately NOT the number above, and there is no pinned cap at all. The two
 * shelves fill at different rates for a structural reason: a card row can arrive
 * as a FOOTPRINT — you opened someone's card and one appeared — while an
 * organization row only ever arrives because the reader pressed a button. A
 * shelf nobody can fill by browsing does not need room for browsing, and a list
 * this short has nothing to sort above anything else.
 */
export const WATCHED_ORGS_CAP = 30

/**
 * 收藏的作品 (works doc §4.6, 2026-08-03 用户裁决).
 *
 * A thousand, and an EVICTION rather than the refusal `watched_orgs` answers
 * with. The two differ because of what a full shelf means: thirty kept
 * organizations is a number a person can hold in their head, so refusing the
 * thirty-first is information they can act on. A bookmark shelf is not curated
 * — it is where a reader drops things over years — and a save button that
 * starts failing is a feature that stopped working. So the oldest row goes.
 *
 * ⚠️ It is the WRITE cap and the READ limit at once (`listSavedWorks`). Two
 * numbers here would mean rows that exist, cannot be seen, and therefore cannot
 * be removed from the only surface that lists them — which is exactly the state
 * a read-only limit of 30 left this table in.
 */
export const SAVED_WORKS_CAP = 1000

export interface ProfileLink {
	name: string
	url: string
	rel: LinkRel
}

export type PrincipalType =
	| 'person'
	| 'organization'
	| 'team'
	| 'project'
	| 'venue'
	| 'event'
	/**
	 * An account held by an AI rather than by a human (docs/alink-duty-mode.md
	 * DP-2): an AI service desk, a duty console, a bot with a public front door.
	 * The only type that may stand its own duty — and the only one whose
	 * visitors are told, at the door, that the thing they are writing to is the
	 * operator's AI rather than a person's gatekeeper.
	 */
	| 'agent'
	| 'other'

export interface PrincipalDescriptor {
	id: string
	type?: PrincipalType
	name?: string
}

export interface PrincipalDocument {
	id: string
	type?: PrincipalType
	name?: string
	description?: string
	avatar_url?: string
	/**
	 * Other HTTPS URLs that lead here (agent-delegation/1.0 §5.4). An alias is an
	 * entry point, never an identity — and a client MUST NOT show one as this
	 * principal's name unless the principal listed it here, because any origin
	 * can redirect to any id while only the document itself can acknowledge.
	 */
	aliases?: readonly string[]
	links?: readonly ProfileLink[]
	controllers: readonly AgentDid[]
	/**
	 * Existence-check endpoint for this principal's delegations (§8.6).
	 * ⚠️ MUST NOT be an endpoint that lets an unauthenticated caller walk the
	 * whole graph: one credential is public, the shape of every relationship a
	 * principal has is not.
	 */
	delegation_query_url?: string
	updated_at?: number
	extra?: Record<string, JsonValue>
}

/**
 * The organization half of a principal document (collaboration doc §41.1).
 *
 * Everything here is opt-in output, never a mirror of internal state: a member
 * appears only when BOTH the organization listed them and that person consented
 * (INV-C5 / §44 公开冒名), and an outcome appears only when every named party
 * signed off. The document has no field for members' counts, roles-at-large,
 * pending work or any aggregate that would let an outsider infer the roster —
 * absence here is the disclosure policy, not an omission to be filled in later.
 */
export interface OrganizationPublicMember {
	principal: PrincipalDescriptor
	/** The role LABEL the organization publishes. Never a capability (INV-O3). */
	role?: string
}

export interface OrganizationPublicOutcome {
	id: string
	statement: string
	recognized_at: number
	/** Parties that co-signed AND opted into being named. */
	parties: readonly PrincipalDescriptor[]
}

export interface OrganizationDocumentExtension {
	organization_type?: string
	/**
	 * ⚠️ There is no `representative` field, and its absence is load-bearing
	 * (§11.1 拍板 14). An organization's door holds no AI and receives no letters,
	 * so a reading agent needs no disclosure about who would read what it writes:
	 * nothing here accepts writing at all. `front_desk` below is the only route
	 * inward, and it points at a PERSON, whose own document carries their own
	 * disclosure.
	 */
	/** §11.5 公开发布 — both forms. Absent — never an empty array — when there
	 * are none: an empty list is the claim 「我们发布了：没有」, absence is not. */
	posts?: readonly OrganizationPublicPost[]
	members?: readonly OrganizationPublicMember[]
	/**
	 * §11.2 接待人 — who a stranger should write to, when the organization has
	 * named someone and that person has agreed.
	 *
	 * A pointer at another principal document, and deliberately nothing more: no
	 * endpoint, no capability, no promise. The reading agent follows `principal.id`
	 * and learns from THAT document what the person's door accepts, which is where
	 * such a promise can actually be kept.
	 */
	front_desk?: OrganizationPublicMember
	outcomes?: readonly OrganizationPublicOutcome[]
}

/**
 * One published sentence (§11.5). `form` is what tells 「我们在找」 from a
 * dated announcement — a reader that ignores it will present a notice as a
 * recruitment line, which is the machine-face version of the shelf-row lie the
 * projection column exists to prevent.
 */
export interface OrganizationPublicPost {
	form: 'seeking' | 'notice'
	/** Only meaningful for `seeking`; a notice always reports `custom`. */
	kind: string
	title: string
	summary?: string
	topics?: readonly string[]
	expires_at?: number
	created_at: number
}

/**
 * Machine-readable declaration of how this link can be engaged (product doc
 * §6.1): each capability names its live endpoint. `converse` joins in WP2 (R1)
 * once the endpoint exists — a document must never advertise a dead surface.
 */
export interface LinkCapabilities {
	/** Structured request intake; absent until the owner has an active contract. */
	intake?: { url: string; request_types: readonly string[] }
	/** MCP endpoint of the owner's Gatekeeper agent. */
	mcp?: { url: string }
	/** Asynchronous visitor conversation (R1); absent until WP2 ships it. */
	converse?: { url: string }
}

/** A publicly visible intent as served on the principal document (§6.1/§6.2). */
export interface PublicIntent {
	kind: string
	title: string
	summary?: string
	topics?: readonly string[]
	context?: Record<string, JsonValue>
	expires_at?: number
	created_at: number
}

export interface ServiceEndpoint {
	type: string
	url: string
	protocols?: readonly string[]
}

/**
 * A profile's index hint (§9). ⚠️ Carries no service URL by design: the agent
 * publishing this profile is the party under verification, so a URL it supplies
 * verifies nothing. The relying party resolves `principal.id` and reads
 * `delegation_query_url` from the authoritative document instead.
 */
export interface DelegationHint {
	id?: string
	principal: PrincipalDescriptor
	relationship?: string
	scopes?: readonly string[]
}

export interface AgentProfileDocument {
	id: AgentDid
	name: string
	username?: string
	description?: string
	avatar_url?: string
	provider?: string
	capabilities?: readonly string[]
	service_endpoints?: readonly ServiceEndpoint[]
	links?: readonly ProfileLink[]
	delegations?: readonly DelegationHint[]
	extra?: Record<string, JsonValue>
	updated_at: number
	event_id: string
}

export const DELEGATION_STATUSES = ['active', 'suspended', 'expired', 'revoked'] as const

export type DelegationStatus = (typeof DELEGATION_STATUSES)[number]

export function isValidDelegationStatus(value: string): value is DelegationStatus {
	return (DELEGATION_STATUSES as readonly string[]).includes(value)
}

export type DelegationRelationship =
	'primary_delegate' | 'assistant' | 'organization_delegate' | 'service_agent' | (string & {})

export interface DelegationGrantPayload {
	id: string
	principal: PrincipalDescriptor
	subject: AgentDid
	relationship?: DelegationRelationship
	scopes: readonly string[]
	constraints?: Record<string, JsonValue>
	not_before?: number
	expires_at?: number
}

export interface DelegationRevokePayload {
	id: string
	principal_id: string
	reason?: string
}

export interface DelegationCredential {
	id: string
	protocol: 'agent-delegation/1.0'
	principal: PrincipalDescriptor
	controller: AgentDid
	subject: AgentDid
	relationship?: DelegationRelationship
	scopes: readonly string[]
	constraints?: Record<string, JsonValue>
	not_before?: number
	expires_at?: number
	status: DelegationStatus
	updated_at: number
	event_id: string
}

export interface DelegationStatusDocument {
	id: string
	status: DelegationStatus
	checked_at: number
	expires_at?: number
	event_id: string
}

/**
 * A delegation query (§8.6). ⚠️ `subject` AND `principal_id` together are what
 * makes a query PUBLIC: it answers one existence question the asker already
 * had both halves of. Drop either half and the same endpoint enumerates one
 * party's delegation graph — an org chart, a household, a legal
 * representation — which is why that shape needs the enumerated party's own
 * authorization and is refused here.
 */
export interface DelegationQuery {
	subject: AgentDid
	principal_id: string
	id?: string
	status?: DelegationStatus
	limit?: number
}

/** The redacted subset §8.6 requires a visible result to keep. */
export interface DelegationSummary {
	id: string
	subject: AgentDid
	principal: PrincipalDescriptor
	scopes: readonly string[]
	status: DelegationStatus
}

export const DELEGATION_QUERY_LIMIT_DEFAULT = 20
export const DELEGATION_QUERY_LIMIT_MAX = 100
