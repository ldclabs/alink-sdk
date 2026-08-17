import type { AgentDid } from './protocols.js'

export type JsonValue =
	string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type IdPrefix =
	| 'agt'
	| 'hcard'
	| 'acard'
	| 'contact'
	| 'rel'
	| 'relctx'
	| 'relperm'
	| 'consent'
	| 'del'
	| 'handle'
	| 'sub'
	| 'usage'
	| 'guest'
	| 'intent'
	| 'match'
	| 'req'
	| 'msg'
	| 'appr'
	| 'audit'
	| 'evt'
	| 'trace'
	| 'contract'
	| 'intake'
	| 'thread'
	| 'tmsg'
	| 'adel'
	| 'emch'
	| 'seat'
	| 'ref'
	| 'oac'
	| 'ogr'
	| 'sq'
	| 'csn'
	| 'cmsg'
	| 'brf'
	| 'cvm'
	| 'offer'
	| 'bkg'
	| 'avw'
	| 'avx'
	| 'mat'
	| 'grove'
	| 'tree'
	| 'seed'
	| 'fruit'
	| 'care'
	| 'gsty'
	| 'gpr'
	| 'gmsg'
	| 'spr'
	// Organization (docs/alink-collaboration.md Part B). The organization
	// PRINCIPAL itself is deliberately absent from this list: it is `org_<xid>`,
	// a minted identity like `conn_<xid>`, validated by its own pattern in
	// organization.ts. Everything below is an object INSIDE an organization.
	| 'mbr'
	| 'orl'
	| 'ocg'
	| 'odel'
	| 'oap'
	| 'oapr'
	| 'oaz'
	| 'olg'
	// Collaboration (Part C–F). `cseat` rather than `seat` — the latter is
	// already the delegate-seat prefix and the two are unrelated objects.
	| 'clb'
	| 'cseat'
	| 'cpt'
	| 'dec'
	| 'cmt'
	| 'dlv'
	| 'ocm'
	| 'cap'
	| 'clg'
	/** One invitation, whichever table it points at (membership or party). The
	 * app lands all three invite contexts on `/-/invites/:id` (design prototype
	 * D5), so they share one unguessable id space. */
	| 'inv'
	/** One work (docs/alink-works.md): a published 作品包. */
	| 'work'
	/** One report filed against a work (§6.6) — a row in the operator queue,
	 * never anything the reported owner sees. */
	| 'wrpt'
	/** Settlement (docs/alink-settlement.md): one owner-configured payment
	 * entry (`smth`), one card issued into a thread (`scrd`), and one report
	 * filed against a card (`srpt`, operator queue only). */
	| 'smth'
	| 'scrd'
	| 'srpt'

/** Per-account billing plan (commercialization doc §2.1). Org plans arrive with
 * the future organization model, not here. */
export type Plan = 'free' | 'plus' | 'pro' | 'max'
export type RecordStatus = 'active' | 'inactive' | 'suspended' | 'deleted'

export type AgentProvider = 'chatgpt' | 'claude' | 'custom' | 'enterprise'

export type HandleClass = 'xid' | 'standard' | 'compact' | 'short' | 'premium'

export type HandleStatus = 'active' | 'grace' | 'cooldown' | 'available' | 'reserved' | 'protected'
export type Visibility = 'public' | 'link_only' | 'network' | 'private'
export type IntentVisibility = 'private' | 'trusted_network' | 'link_only' | 'public'
export type IntentStatus = 'draft' | 'active' | 'paused' | 'expired' | 'completed'

/** What the owner is looking for (product doc §6.2). `custom` is the catch-all. */
export type IntentKind =
	| 'hiring'
	| 'job_seeking'
	| 'cofounder'
	| 'fundraising'
	| 'investing'
	| 'advising'
	| 'partnership'
	| 'speaking'
	| 'learning'
	| 'custom'

export type RelationshipState =
	| 'draft'
	| 'pending_counterparty'
	| 'active_weak'
	| 'active_trusted'
	| 'collaborator'
	| 'muted'
	| 'revoked'

export type RelationshipSourceType = 'scan_card' | 'import' | 'manual' | 'event' | 'intro' | 'email'

export type TrustLevel = 'weak' | 'warm' | 'trusted' | 'collaborator' | 'intimate'

export type RelationshipPermissionScope =
	'contact:ask' | 'meeting:request' | 'intro:request' | 'context:share'

export type RelationshipPermissionLevel =
	'denied' | 'draft_only' | 'approval_required' | 'auto_allowed'

export type RequestType = 'chat' | 'intro' | 'meeting' | 'ask_question' | 'update_context'

export type AgentRequestStatus =
	| 'draft'
	| 'policy_checked'
	| 'approval_required'
	| 'approved'
	| 'rejected'
	| 'queued'
	| 'delivered'
	| 'counterparty_review'
	| 'accepted'
	| 'declined'
	| 'more_context_required'
	| 'completed'
	| 'closed'

export type ConsentStatus = 'active' | 'expired' | 'revoked' | 'suspended'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'
export type ActorType = 'user' | 'agent' | 'system' | 'admin'
/**
 * Whether a bearer token was minted for a human owner session ('user') or an
 * autonomous agent ('agent'). Human-only gates (approval.submit, consent.grant,
 * sensitive updates, account deletion) require 'user' — an agent must never be
 * able to self-satisfy a human-in-the-loop boundary (product doc §7, §13.2).
 */
/**
 * `webview` is the read-only ticket a WebView carries (mobile devplan §9A.4).
 *
 * ⚠️ It is a THIRD kind rather than a narrowly-scoped `user`, because every
 * existing gate in this codebase is written as `actorKind !== 'user'` or
 * `!== 'agent'` — so a new kind is rejected everywhere by construction, and a
 * surface has to opt IN to accepting it. A ticket that rode in as a `user` with
 * fewer scopes would instead be accepted everywhere that forgot to check.
 */
export type ActorKind = 'user' | 'agent' | 'webview'
export type RiskLevel = 'low' | 'normal' | 'elevated' | 'high'
export type Sensitivity = 'low' | 'medium' | 'high' | 'highly_sensitive'

export type Scope =
	| 'profile:read'
	| 'agent:read'
	| 'relationships:read'
	| 'relationships:write'
	| 'relationships:sensitive_read'
	| 'intents:read'
	| 'intents:write'
	| 'drafts:write'
	| 'requests:read'
	| 'requests:write'
	| 'messages:send'
	| 'inbox:read'
	| 'inbox:write'
	| 'approvals:read'
	| 'approvals:write'
	| 'consent:read'
	| 'consent:write'
	| 'audit:read'
	| 'assistant:read'
	| 'assistant:write'
	| 'scheduling:read'
	/**
	 * 精灵 (sprite devplan TD-S9). The read half is the sprite's own state; the
	 * write half is the ONLY way anything in this system can make a sprite move.
	 * Revoking `sprite:write` from an agent cuts its drive; revoking it from
	 * every agent puts the sprite to sleep — there is no human fallback by
	 * design (product §2.10 驱动恒来自心智).
	 */
	| 'sprite:read'
	| 'grove:read'
	| 'sprite:write'
	/**
	 * 值守 (docs/alink-duty-mode.md DP-3). The narrowest grant in the system by
	 * construction: it receives visitor letters and public context and nothing
	 * else. It is deliberately NOT part of the default agent set — an account
	 * that connects a personal AI to manage its alink must not thereby put that
	 * AI on the front door, and the operator's promise not to leak private data
	 * is replaced by never handing any over.
	 */
	| 'duty:read'
	| 'duty:write'
	/**
	 * The organization and collaboration READ surfaces (collaboration devplan
	 * TD-7). They arrived with WP-K8 rather than with the MCP tool face (K9)
	 * because K8 is where their absence first bit: §42's last line forbids
	 * merging 值守 with organization management, and until these existed, ANY
	 * connection on a member's bearer could read `/v1/orgs/:id` — including one
	 * whose whole grant was `duty:*`.
	 *
	 * K9 is where they start to MEAN something rather than only to exclude:
	 * until now every read behind them also called `requireOwnerActor`, so the
	 * scope gated a door that was shut anyway. The tool face opens that door,
	 * and these two are what the owner consented to when it did.
	 */
	| 'org:read'
	| 'collab:read'
	/**
	 * The write halves (collaboration devplan TD-7, product §50), appended in
	 * WP-K9 with the tools that need them.
	 *
	 * `*:scribe` is the drafting pair, and drafting is all it is: every tool
	 * that carries one returns a proposal for the owner to submit and writes
	 * nothing (§51/§52's 「是否直接生效：否」 column, enforced by the handlers
	 * rather than promised by them). §31.1 is the reason the pair exists at all
	 * — a Person AI 「可以读取和整理本人获授权的协作内容」 and may not confirm
	 * anything.
	 *
	 * `org:represent` is asked for on top when a collaboration write names an
	 * ORGANIZATION as its `actsFor`: speaking in Studio X's name is not the same
	 * permission as speaking in your own, and §39's whole console exists because
	 * those two are easy to confuse. It is never in a tool's static
	 * `requiredScopes` — the same tool is legitimate for the person themselves
	 * without it.
	 *
	 * `collab:operate` and `collab:steward` are the two that actually write.
	 * `collab:operate` records a deliverable or an external reference into the
	 * shared record other Parties read; `collab:steward` covers the convener's
	 * own preparation (§20 「准备邀请和复盘」). Both stay out of the default
	 * agent grant for duty's reason (services/auth.ts): connecting a personal AI
	 * to tidy your own alink must not thereby put it inside somebody else's
	 * table.
	 */
	| 'org:scribe'
	| 'org:represent'
	| 'collab:scribe'
	| 'collab:operate'
	| 'collab:steward'

export type ToolAction =
	| 'profile.get_self'
	| 'agent_card.get_self'
	| 'relationship.search'
	| 'relationship.get'
	| 'relationship.create_from_encounter'
	| 'relationship.update_context'
	| 'intent.create'
	| 'intent.list'
	| 'intent.update'
	| 'intent.match_relationships'
	| 'intent.discover'
	| 'network.path_to'
	| 'outreach.draft'
	| 'request.create_activation'
	| 'request.send_to_agent'
	| 'request.get_status'
	| 'inbox.list'
	| 'inbox.get'
	| 'inbox.respond'
	| 'approval.get_pending'
	| 'approval.get_status'
	| 'approval.submit'
	| 'audit.query'
	| 'consent.grant'
	| 'consent.revoke'
	| 'assistant.get_material'
	| 'assistant.update_material'
	| 'scheduling.get_overview'
	| 'scheduling.list_bookings'
	| 'locker.list_materials'
	| 'locker.list_grants'
	| 'locker.revoke_grant'
	| 'locker.prepare_upload'
	| 'locker.commit_upload'
	| 'locker.update_material'
	| 'locker.set_material_status'
	// 精灵 (sprite devplan TD-S9): the whole drive surface, and deliberately the
	// whole of it — 确认出生 / 回退形态 / 请离 / 三开关 are owner HTTP endpoints
	// and have no tool, because confirming is not driving.
	| 'sprite.status'
	| 'sprite.set_form'
	| 'sprite.wake'
	| 'sprite.sleep'
	| 'sprite.look'
	| 'sprite.act'
	// 值守 v2 (docs/alink-representative.md §13.5): pull the new letters,
	// backfill one conversation, answer, hand one back, clock off. Five verbs
	// and no sixth — there is no way to read the owner's inbox, relationships
	// or private materials through this surface, by construction.
	| 'duty.next'
	| 'duty.session'
	| 'duty.reply'
	| 'duty.pass'
	| 'duty.release'
	// 组织 (collaboration §51, WP-K9). Nine, and the nine the product document
	// names — the five that must NEVER exist are listed beside them in
	// DELIBERATELY_ABSENT_ORG_TOOLS and asserted against this union.
	//
	// Six of the nine are `draft_*`/`prepare_*` and none of them writes: an
	// organization's every write is a member's own act (TD-1), and a tool that
	// could invite, promote or commit on their behalf would be the silent-join
	// API §7.2 spends a whole section forbidding.
	| 'org.list'
	| 'org.get'
	| 'org.list_members'
	| 'org.draft_member_invite'
	| 'org.draft_role_change'
	| 'org.draft_collaboration_join'
	| 'org.draft_commitment'
	| 'org.prepare_authorization'
	| 'org.read_audit'
	// 协作 (collaboration §52, WP-K9). Nine again, and exactly two of them write:
	// `log_deliverable` (「是，但不等于兑现」) and `sync_connector` (按 grant).
	// Everything that BINDS a Party — accepting, authorizing, recognizing — is
	// absent from this list on purpose and asserted absent in
	// DELIBERATELY_ABSENT_COLLAB_TOOLS.
	| 'collab.list'
	| 'collab.get'
	| 'collab.read_ledger'
	| 'collab.draft_decision'
	| 'collab.draft_commitment'
	| 'collab.log_deliverable'
	| 'collab.draft_outcome'
	| 'collab.sync_connector'
	| 'collab.prepare_glass_session'
	/**
	 * 作品 (docs/alink-works.md §10.2). Five tools, and deliberately NO `works:*`
	 * scope: managing your own public content is content-class writing, the same
	 * trust tier the locker's cabinet management sits in (§17.2 用户等同信任), so
	 * they ride `assistant:read` / `assistant:write` — which most connections
	 * already hold, meaning an agent that finishes a thing can publish it without
	 * the owner re-consenting to anything.
	 */
	| 'work.list'
	| 'work.prepare_upload'
	| 'work.commit_upload'
	| 'work.update'
	| 'work.delete'

export type DecisionStatus =
	| 'allowed'
	| 'redacted'
	| 'draft_only'
	| 'approval_required'
	| 'counterparty_consent_required'
	| 'denied'

export type Redaction =
	| 'hide_name'
	| 'hide_private_note'
	| 'hide_contact_channels'
	| 'hide_phone_number'
	| 'hide_email'
	| 'hide_source_detail'
	| 'hide_sensitive_summary'
	| 'hide_second_degree_path'

export type ReasonCode =
	| 'SCOPE_ALLOWED'
	| 'SCOPE_MISSING'
	| 'RELATIONSHIPS_READ_ALLOWED'
	| 'RELATIONSHIP_NOT_ACTIVE'
	| 'RELATIONSHIP_MUTED'
	| 'RELATIONSHIP_REVOKED'
	| 'SENSITIVE_FIELDS_REDACTED'
	| 'SENSITIVE_READ_NOT_GRANTED'
	| 'TOPIC_ALLOWED'
	| 'TOPIC_RESTRICTED'
	| 'WEAK_TIE'
	| 'WARM_TIE'
	| 'TRUSTED_TIE'
	| 'FREQUENCY_OK'
	| 'FREQUENCY_LIMIT'
	| 'MEETING_REQUEST'
	| 'INTRO_REQUEST'
	| 'NO_STANDING_PERMISSION'
	| 'AUTO_PERMISSION'
	| 'APPROVAL_REQUIRED_BY_PERMISSION'
	| 'DRAFT_ONLY_BY_PERMISSION'
	| 'HIGH_RISK'
	| 'BULK_ACTION_DENIED'
	| 'GRAPH_SCRAPING_RISK'
	| 'COUNTERPARTY_CONSENT_REQUIRED'
	| 'IDEMPOTENCY_REQUIRED'
	| 'POLICY_ALLOWED'
	| 'QUOTA_EXCEEDED'
	| 'PLAN_REQUIRED'
	| 'HANDLE_CLASS_EXCEEDED'
	| 'SENSITIVE_READ_GRANTED'
	| 'CONTRACT_TYPE_NOT_ALLOWED'
	| 'CONTRACT_TOPIC_BLOCKED'
	| 'CONTRACT_TOPIC_NOT_ALLOWED'
	| 'MISSING_REQUIRED_CONTEXT'
	| 'ANTI_ABUSE_BLOCKED'
	| 'ESCALATION_REQUIRED'
	| 'AUTO_DECLINED'
	| 'RULE_LAYER_ONLY'

export interface User {
	/** Permanent identity = the public xid (one value, one name). */
	id: string
	displayName: string
	handle?: string
	primaryEmailHash?: string
	timezone: string
	locale: string
	status: RecordStatus
	preferences?: JsonValue
	createdAt: number
	updatedAt: number
}

export interface HandleRecord {
	id: string
	handle: string
	class: HandleClass
	status: HandleStatus
	userId?: string
	boundAt?: number
	renewsAt?: number
	graceUntil?: number
	cooldownUntil?: number
	createdAt: number
	updatedAt: number
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
export type BillingProvider = 'stripe'
export type BillingInterval = 'month' | 'year'
export type ValueReportCadence = 'none' | 'monthly' | 'weekly'

/**
 * Local projection of the provider-side subscription. The billing provider
 * (Stripe) is the source of truth for money and subscription state; this row
 * is the queryable copy that drives entitlements (commercialization doc §9).
 */
export interface Subscription {
	id: string
	userId: string
	plan: Plan
	status: SubscriptionStatus
	provider: BillingProvider
	providerCustomerId: string
	providerSubscriptionId?: string
	interval: BillingInterval
	currentPeriodStart?: number
	currentPeriodEnd?: number
	cancelAtPeriodEnd: boolean
	trialEndsAt?: number
	/** Clock origin for the dunning downgrade ladder (commercialization doc §5.4). */
	pastDueSince?: number
	createdAt: number
	updatedAt: number
}

/**
 * Effective plan entitlements (commercialization doc §2.1 matrix). Static per
 * plan; computed values are cached in KV keyed by user and invalidated on
 * subscription change. Protective capabilities (export/delete, AI disclosure,
 * false-positive guardrails) are never entitlement-gated.
 */
/**
 * Signals read-depth tiers (commercialization doc §2.4.2): counts only, plus
 * visitor identity/categories, or the full encounter timeline. Collection is
 * never tiered — only what the read path returns.
 */
export type SignalsDepth = 'counts' | 'identity' | 'timeline'

export interface Entitlement {
	plan: Plan
	/** Highest bindable custom-handle class; 'xid' means no custom handle. */
	handleClassLimit: HandleClass
	aiTriagePerMonth: number
	maxRelationships: number
	/**
	 * Per-link daily conversation turns (commercialization doc §2.3). An
	 * anti-abuse ceiling, not expected consumption — exceeding it falls back to
	 * the static form (never an error, the link stays usable).
	 */
	conversationDailyTurns: number
	/** Custom agentPersona (style/languages/signatureLine), Plus and above. */
	personaCustom: boolean
	/**
	 * 值守模式 (duty-mode plan-gate DP-P2): whether this account may hand its
	 * front door to an external agent over MCP. **True on every plan** since
	 * evidence-plan DP-E8 (2026-08-17) — 值守 is free, and the reason is in the
	 * note beside FREE in domain/billing.ts. The field stays because it is the
	 * one place that decides, and it is on the wire as `duty.planAllowed`.
	 *
	 * Gates TAKING the door — the lease, the duty scopes at consent, the
	 * resource/subscription face and the queue consumer's duty fork — but never
	 * `duty.reply` on a letter already in an agent's hands: a visitor is
	 * standing there, and a lapsed plan must cost them nothing (the locker's
	 * already-issued links, below, are the same shape).
	 *
	 * Being an agent-held account (`principal_type = 'agent'`) is NOT gated on
	 * any plan and never will be: that bit is a disclosure about who answers
	 * the door, and honesty is not a paid feature (DP-P1). Without this
	 * entitlement an agent-held account simply keeps alink's hosted
	 * representative at the door.
	 */
	dutyMode: boolean
	/**
	 * Assistant Brief entries the plan may publish (assistant-memory doc §3.1):
	 * owner-curated background notes the visitor assistant answers from. Gates
	 * the WRITE path only — entries published under a higher plan keep working
	 * after a downgrade (identity continuity; the persona-echo rule's sibling).
	 */
	assistantBriefEntries: number
	signalsDepth: SignalsDepth
	/**
	 * Concurrent active intents. Heartbeat operations (renew, edit, complete)
	 * are never gated — only creating beyond the cap is (§2.3: 心跳不收费).
	 */
	maxActiveIntents: number
	/**
	 * Daily `intent.discover` searches (discovery design D8): the anti-scrape
	 * hard gate for the network-wide index. Operator-adjustable via the KV
	 * entitlement flags; counted in a KV fixed window per user per UTC day.
	 */
	discoveryDailySearches: number
	/**
	 * Product-UI audit query window in days (commercialization doc §2.1). This
	 * is the *visible* window only — actual audit retention is a compliance
	 * floor of AUDIT_RETENTION_MIN_DAYS regardless of plan (product doc §13.1
	 * "retention vs visibility"). Retention jobs must never delete by this field.
	 */
	auditVisibleDays: number
	requestRetentionDays: number
	delegateSeats: number
	customContract: boolean
	multiContract: boolean
	aiFollowup: boolean
	/**
	 * Booking slots (L3 会安排, booking doc §10): the whole scheduling surface
	 * — console panel, approve-with-slots, offers/bookings. Pro+. Gates the
	 * feature surface, not the thread: plain release + manual time talk in the
	 * thread is a message, never gated.
	 */
	autoArrange: boolean
	/**
	 * Settlement cards (settlement doc §9): the owner surface — payment-method
	 * panel and issuing a card into an already-released thread. Pro+, same tier
	 * as `autoArrange` because it is the step after "把人送到门口".
	 *
	 * Gates the FEATURE, never the money: alink takes no cut (INV-3), and the
	 * amount ceiling is a global operator parameter that must never vary by
	 * plan — pricing risk exposure would turn the guard rail into a paywall
	 * (§9). Past-due blocks issuing NEW cards while already-issued ones keep
	 * working: the payer must never be locked out by the owner's billing.
	 */
	settlement: boolean
	/**
	 * Material locker RECEIVE side (L3 指定资料, material-locker doc DP-B2-5):
	 * the three hand-out surfaces — converse catalog, release attach, thread
	 * deal. Pro+. Storage + §3.7 outbound attachments stay all-plan (Free 小
	 * 配额), governed by the three quota numbers below, never by this bit.
	 */
	materialLocker: boolean
	/**
	 * Any file type in the locker (material-locker doc DP-B2-7). False = the
	 * DP-B2-3 whitelist (PDF / PNG / JPEG / WebP / markdown); true = every
	 * extension, pinned as opaque bytes.
	 *
	 * A capability bit rather than a quota because it is not a cost dial: the
	 * bytes cost the same either way. What it prices is the trust the paywall
	 * buys — a real-name payment trail behind every file that leaves al.ink.
	 * The download armor (attachment, off-origin, audited, revocable) does not
	 * vary with it, so a wider type list widens no exposure the whitelist was
	 * closing.
	 */
	lockerAnyFileType: boolean
	/** Locker storage quota: max stored files (material-locker doc §3.1). */
	lockerMaxFiles: number
	/** Locker storage quota: total bytes across stored files. */
	lockerMaxTotalBytes: number
	/** Locker storage quota: single-file byte cap (markdown is further capped
	 * at LOCKER_LIMITS.markdownMaxBytes; flags:locker.maxFileBytes caps globally). */
	lockerMaxFileBytes: number
	/**
	 * How many materials may sit at the `public` audience (material-locker
	 * DP-B2-6 / §3.1a). This is CAPACITY, and capacity is what plans price —
	 * unlike the card's accent, which is expression and is free at every tier
	 * (card-page v2 §10.4). Kept small on purpose at every tier: the locker is a
	 * hand-out rule engine, and an owner with twenty public files has built a
	 * file host, which §1.4 still refuses to be.
	 */
	lockerPublicFiles: number
	/**
	 * Intent forms (intent-forms doc DP-F-4): how many ACTIVE intents may carry
	 * a form (0 = the surface is off). Gates authoring AND the submit-side
	 * acceptance — a lapsed plan closes the receive surface (submits 409 to
	 * the generic form) while the intent card itself keeps rendering.
	 */
	intentForms: number
	/**
	 * 作品 (works doc §8.4, DP-W7). Four numbers and no boolean, on purpose:
	 * **Free must have works** (3 of them). A card that cannot publish anything
	 * grows no sharing loop, so the free tier's works are an acquisition cost,
	 * not leakage — and «video works» needs no capability flag either, because
	 * a 5 MB per-file ceiling already says which tiers can hold one.
	 *
	 * ⚠️ Deliberately absent from degradeToFreeTier: a downgrade closes NEW
	 * publishing, never what is already published (§8.4 降档语义). The reader's
	 * link must not die because the author stopped paying.
	 */
	worksMaxCount: number
	/** Byte cap on any single file inside a bundle. */
	worksMaxFileBytes: number
	/** Files one bundle may hold — also the ceiling on commit's per-file HEADs,
	 * which is why it stays well inside the paid plan's subrequest budget. */
	worksMaxFilesPerWork: number
	/** Bytes across every published and draft work this account holds. */
	worksMaxTotalBytes: number
	/**
	 * ⚠️ `orgCount` USED TO LIVE HERE and was removed on purpose (2026-08-01).
	 * Founding is now ONE organization per account at every tier, expressed as a
	 * constant in services/organization.ts rather than as a plan number.
	 *
	 * The reason is the handle namespace. Every organization is its own
	 * principal in HandleRegistryDO, so it holds its own custom name — and the
	 * class of that name comes from the FOUNDER's plan. A plan that let one
	 * payer found N organizations therefore sold N custom names for one
	 * subscription: at `orgCount: 20` a single Max account could hold 21 short
	 * (3–4 character) names for $99.9, against $2,097.9 for the same names held
	 * as individuals. The scarce thing a price ladder exists to ration was
	 * being handed out at 1/21 of its price through a side door.
	 *
	 * Being INVITED into an organization stays free at every tier and has no
	 * entitlement anywhere (§45.1 受邀恒免费) — a cap on joining would make one
	 * person's plan a wall around someone else's collaboration.
	 */
	/**
	 * Active members ONE of this account's organizations may hold (拍板 2: Free
	 * gets 3, permanently — the long-term shape of a one-person studio, not a
	 * trial). Gates INVITING beyond the cap; an already-active member is never
	 * removed by a downgrade, because identity continuity outranks revenue.
	 */
	orgActiveMembers: number
	/**
	 * Custom OrgApprovalPolicy rows (§45.2). Zero does not mean "no approvals" —
	 * it means every action falls to the controller default (§10.1), which is
	 * the STRICTER end. Paying buys the ability to loosen, never to bypass.
	 */
	orgApprovalPolicies: number
	valueReport: ValueReportCadence
	removeBranding: boolean
	/** Bumped when the entitlement table changes; used for cache invalidation. */
	version: number
}

/**
 * Monthly usage counters (the UserDO `usage_periods` row shape). Live counts
 * accumulate in the user's UserDO; the Analytics Engine usage stream carries
 * cross-user deltas and token totals feed the §7 cost model backfill.
 */
export interface UsageCounter {
	id: string
	userId: string
	/** Calendar month in 'YYYY-MM'. */
	period: string
	aiTriageCount: number
	llmInputTokens: number
	llmOutputTokens: number
	requestsReceived: number
	/** Visitor-conversation turns answered (commercialization doc §14, v2.0). */
	converseTurns: number
	createdAt: number
	updatedAt: number
}

// ---------------------------------------------------------------------------
// Referral (docs/alink-credits.md §10.1). The conversion count is a derived
// view of the referrals table — there is no credit ledger, balance, or price
// anchor. Referrals must never feed the policy engine, triage, or any
// trust/matching computation (credits doc §0 #1).

export type ReferralStatus =
	| 'recorded' // attribution on record, conversion-ineligible (referrer was not
	// on a paid plan at attribution time, §3.1 — the row still feeds §3.7 network
	// achievements and the §8 attribution metrics); terminal by construction
	| 'pending' // attribution locked at signup, awaiting the first paid invoice
	| 'qualified' // first invoice paid, inside the hold window
	| 'rewarded' // counted (+1); terminal — a conversion is never clawed back (§3.5)
	| 'rejected' // risk interception, or the referee canceled during the hold
	| 'expired' // conversion window elapsed without a paid invoice
	| 'forfeited' // referrer no longer on an active paid plan at grant time

/** Attribution touchpoint: which signup CTA carried the owner context (§3.2).
 * 'referred_intro' (entry plan D1): the referee arrived on a signed referral
 * link and later claimed/registered — attribution goes to the INTRO ISSUER,
 * not the receiver. Server-triggered only, never a client source. */
export type ReferralSource =
	| 'card_page'
	| 'receipt_footer'
	| 'decline_footer'
	| 'thread_claim'
	| 'status_claim'
	| 'referred_intro'

export interface Referral {
	id: string
	referrerUserId: string
	/** Anonymized (irreversible hash) when the referee deletes their account (§7). */
	refereeUserId: string
	source: ReferralSource
	status: ReferralStatus
	qualifiedAt?: number
	/** qualified + rewardHoldDays; the grant scan acts after this instant. */
	rewardDueAt?: number
	rewardedAt?: number
	/** Stripe invoice id of the referee's first paid invoice (qualify evidence). */
	firstInvoiceId?: string
	riskFlags?: readonly string[]
	createdAt: number
	updatedAt: number
}

/**
 * Operational parameters of the referral mechanism (credits doc §10.3). All
 * values are unvalidated hypotheses adjustable via the `flags:referral` KV
 * override; capability gates (no purchase / transfer / cash-out / pricing)
 * are policy and deliberately NOT represented here.
 */
export interface ReferralParams {
	/** Hold between the first paid invoice and the count (days): refund window + privacy blur (§3.4). */
	rewardHoldDays: number
	/** Extra postponement while the referrer is past_due before forfeiting (days). */
	referrerPastDueGraceDays: number
	/** Referee must pay their first invoice within this window after signup (days). */
	conversionWindowDays: number
	/** Auto-counted conversions per referrer per calendar year; beyond -> manual review. */
	annualAutoRewardCap: number
	/** Signed referral links (entry plan D1): tokens one user may issue per
	 * calendar month. The anti-"引荐链接批发" throttle (§15.2: a paid-outreach
	 * channel must never emerge) — small on purpose, flag-adjustable. */
	introMonthlyLimit: number
	/** Cumulative ladder unit of the permanent-handle milestone perk (credits
	 * doc §4): claim N of the perk unlocks at N × unit rewarded conversions.
	 * A ladder, never a spend — the conversion count itself never decreases
	 * (§0 #4: achievements are a scoreboard, not currency). 0 disables the
	 * perk (endpoint refuses, the perks block disappears from /v1/referral). */
	permanentHandleUnit: number
	/** Bumped when referral param defaults change; drives cache invalidation. */
	version: number
}

export interface Agent {
	id: string
	userId: string
	did?: AgentDid
	name: string
	provider?: AgentProvider
	clientId?: string
	status: RecordStatus
	lastSeenAt?: number
	createdAt: number
	updatedAt: number
}

export interface Relationship {
	id: string
	ownerUserId: string
	contactId: string
	sourceType: RelationshipSourceType
	sourceRefId?: string
	state: RelationshipState
	temperature: number
	trustLevel: TrustLevel
	lastInteractionAt?: number
	nextFollowupAt?: number
	topics: readonly string[]
	createdAt: number
	updatedAt: number
}

export interface RelationshipContext {
	id: string
	relationshipId: string
	publicSummary?: string
	topics: readonly string[]
	embeddingStatus: 'pending' | 'ready' | 'skipped' | 'failed'
	sensitivity: Sensitivity
	createdAt: number
	updatedAt: number
}

export interface PermissionConstraints {
	topics?: readonly string[]
	maxFrequencyDays?: number
	maxDurationMinutes?: number
	expiresAt?: number
}

export interface RelationshipPermission {
	id?: string
	relationshipId?: string
	scope: RelationshipPermissionScope
	allowedLevel: RelationshipPermissionLevel
	constraints?: PermissionConstraints
	expiresAt?: number
	revokedAt?: number
}

export interface ConsentGrant {
	id: string
	grantorUserId: string
	granteeAgentId?: string
	granteeUserId?: string
	resourceType: 'profile' | 'relationship' | 'intent' | 'inbox' | 'audit'
	resourceId?: string
	scopes: readonly Scope[]
	constraints?: JsonValue
	status: ConsentStatus
	expiresAt?: number
	revokedAt?: number
	createdAt: number
	updatedAt: number
}

export interface Intent {
	id: string
	ownerUserId: string
	kind: IntentKind
	title: string
	publicSummary?: string
	topics: readonly string[]
	/** Optional structured context (stage, domain, region, time window — §6.2). */
	context?: Record<string, JsonValue>
	/** Phrasing-template attribution (`{kind}.{direct|subtle|open}`, §6.2 话术
	 * 模板): analytics dimension only — never published on any public surface. */
	templateId?: string
	visibility: IntentVisibility
	status: IntentStatus
	/** Required while status is 'active' (§6.2); default now + INTENT_DEFAULT_TTL_MS. */
	expiresAt?: number
	createdAt: number
	updatedAt: number
}

export interface AgentRequest {
	id: string
	requesterUserId: string
	requesterAgentId: string
	targetUserId?: string
	targetRelationshipId?: string
	intentId?: string
	requestType: RequestType
	status: AgentRequestStatus
	policyDecision?: DecisionStatus
	riskScore?: number
	messagePublicSummary?: string
	idempotencyKey?: string
	workflowId?: string
	createdAt: number
	updatedAt: number
}

export interface Approval {
	id: string
	userId: string
	requestId: string
	approvalType: string
	status: ApprovalStatus
	proofHash?: string
	expiresAt?: number
	decidedAt?: number
	createdAt: number
	updatedAt: number
}

// ---------------------------------------------------------------------------
// Gatekeeper: Contact Contract + Request Intake (product doc §6.1, §6.2)

/** Intake request taxonomy (product doc §6.1/§6.2 allowedRequestTypes). */
export type IntakeRequestType =
	'ask' | 'meeting' | 'intro' | 'collaboration' | 'media' | 'hiring' | 'pitch'

export type ContactTemplateId =
	'open' | 'investor' | 'founder' | 'open_office_hours' | 'private' | 'event' | 'custom'

export type AutoReplyTone = 'warm' | 'neutral' | 'formal'

/**
 * How the owner's assistant speaks on the public link (product doc §6.3).
 * Voice/tone reuses autoReply.tone; these are the Plus+ customization knobs
 * (entitlement.personaCustom gates the write path, never the read path).
 */
export interface AgentPersona {
	/** Short free-text voice directive, e.g. "concise, no fluff" (bounded). */
	style?: string
	/** Preferred reply languages (BCP-47-ish tags); empty = follow the visitor. */
	languages?: readonly string[]
	/** One line appended under the assistant's replies (before the AI notice). */
	signatureLine?: string
}

/**
 * The visitor-conversation block of the contract (product doc §6.3): whether
 * and how much the assistant converses on the public link (R1). Deliberately
 * NO `mustNotReveal` field — non-disclosure of private context is an
 * architecture guarantee (§13.6), not a configuration option.
 */
export interface ContractConversation {
	/** Off = the card is form-only (also the guardrail-forced state, §9.2). */
	enabled: boolean
	/** Visitor turns per session (default 10, §6.3). */
	maxTurnsPerVisitor: number
	/**
	 * Owner-set daily turn ceiling for this link; 0 = use the plan quota
	 * (entitlement.conversationDailyTurns). Effective daily limit is
	 * min(dailyBudget || ∞, plan quota).
	 */
	dailyBudget: number
	/**
	 * Narrowing of disclosureFields the assistant may talk about; empty =
	 * the full disclosureFields set. Effective set is the intersection.
	 */
	canAnswerAbout: readonly string[]
	/**
	 * Visitor memory (assistant-memory doc §3.3): whether returning visitors'
	 * sessions distill into (and read back) a per-visitor memory. Owner-level
	 * off switch, default on; never plan-gated (network side is the
	 * denominator). Off = sessions carry no memory key: nothing is read,
	 * nothing distills.
	 */
	visitorMemory: boolean
}

/**
 * Machine-executable declaration of "how I am willing to be contacted"
 * (product doc §6.1). Versioned: an edit produces a new version; historical
 * intakes are judged against the version in effect when submitted. Stored 1:N,
 * exactly one active per principal at any time.
 *
 * v2.6: release always opens an in-site thread (§6.10) — the former
 * contactChannelPolicy/onApproveChannel delivery branches and the
 * autoAcknowledge receipt mail no longer exist.
 */
export interface ContactContract {
	id: string
	principalUserId: string
	version: number
	templateId: ContactTemplateId
	active: boolean
	effectiveFrom: number
	expiresAt?: number
	allowedRequestTypes: readonly IntakeRequestType[]
	allowedTopics: readonly string[]
	blockedTopics: readonly string[]
	/** Required context fields per request type (e.g. pitch → [deckUrl,...]). */
	requiredContextFields: Partial<Record<IntakeRequestType, readonly string[]>>
	autoReply: {
		tone: AutoReplyTone
		/** Off during launch until the false-positive rate clears (§5.5). */
		autoDeclineEnabled: boolean
	}
	/** Request traits that always force human escalation. */
	escalateAlways: readonly IntakeRequestType[]
	responseSlaHours: number
	maxPerSenderDays: number
	disclosureFields: readonly string[]
	/** Assistant voice customization (Plus+); absent = template/tone defaults. */
	agentPersona?: AgentPersona
	/** Visitor-conversation behavior (R1); templates provide the defaults. */
	conversation: ContractConversation
	createdAt: number
	updatedAt: number
}

/**
 * Where a structured request converged from (product doc §6.5): the visitor
 * conversation (R1), the static form fallback, an agent channel (A2A), or an
 * inbound mail to the owner's `<xid>@` alias (email-alias doc §5.4). 'email'
 * is minted only by the Email Worker handler, never by the public HTTP form.
 */
export type IntakeOrigin = 'conversation' | 'form' | 'agent' | 'email'

/**
 * Slot-offer ledger states (booking doc §3.2, `referral_intros` 范式):
 * single-use, atomically consumed by the booking confirm, expirable by TTL,
 * owner-revocable, or superseded by a re-deal (「都不行」→ 重新推荐时段).
 */
export type SlotOfferStatus = 'issued' | 'consumed' | 'expired' | 'revoked' | 'redealt'

/**
 * Settlement-method kinds (settlement doc §4). v1 accepts `link` ONLY: `image`
 * (收款码) rides S-b and `crypto` is refused at the write path (§4.3) — the
 * enum member exists so opening S-crypto needs no schema change.
 */
export type SettlementMethodKind = 'link' | 'image' | 'crypto'

/**
 * Settlement-card ledger states (settlement doc §3.4, `slot_offers` 范式).
 * `marked_paid` is reached when EITHER side first marks; the two booleans are
 * stored separately and a disagreement is displayed as-is — alink never
 * adjudicates (INV-3).
 */
export type SettlementCardStatus = 'issued' | 'marked_paid' | 'revoked' | 'expired'

/**
 * What a settlement card may be attached to (settlement doc §10). The enum is
 * the App Store guard, not a product preference: in-app digital content
 * (works, locker files) would fall under Apple 3.1.3's IAP requirement, so it
 * is pinned out of reach at the type level rather than left to review.
 */
export type SettlementSubjectKind = 'booking' | 'none'

/** Coarse-grained, sender-visible intake status (product doc §5.2). */
export type IntakeStatus =
	'received' | 'needs_more_context' | 'triaged' | 'approved' | 'replied' | 'declined' | 'closed'

/** AI/rule triage bucket (product doc §5.3 grouping). */
export type TriageBand = 'suggested_allow' | 'needs_review' | 'needs_more_context' | 'auto_declined'

/**
 * Every deterministic signal the rule layer and the heuristic fallback can raise.
 * These are owner-facing (§13.4 keeps them off the sender's status page), so they
 * must render in the owner's locale — hence a code the client maps to a message,
 * not a prebaked English sentence.
 */
export type TriageReasonCode =
	| 'honeypot'
	| 'request_type_not_accepted'
	| 'topic_blocked'
	| 'frequency_limit'
	| 'missing_context'
	| 'no_topic_overlap'
	| 'always_escalates'
	| 'no_verifiable_link'
	| 'short_subject'
	| 'multiple_links'
	| 'ai_unavailable'
	| 'ai_quota_exhausted'
	| 'supplement_round'
	| 'context_still_incomplete'
	/** Entry plan D1: the submit carried a server-verified referral token, so a
	 * rule-layer reject was lifted into the human queue (warm-intro 提权). */
	| 'verified_referral'
	/** Intent forms (INV-F-3): a form submission always escalates to the human
	 * queue — the application-review semantics, never an automated release. */
	| 'form_submission'

/**
 * A triage reason chip. `code` is a deterministic signal the client localizes;
 * `text` is free-form model output, which only the model can phrase and which is
 * therefore passed through as-is. Rows written before this split hold bare
 * strings — they decode to the `text` variant, so they still render.
 */
export type TriageReason =
	| { kind: 'code'; code: TriageReasonCode; params?: Record<string, string | number> }
	| { kind: 'text'; text: string }

export interface IntakeRequester {
	name: string
	org?: string
	role?: string
	verifiableLink?: string
	/**
	 * Reply channel. Ownership is proven lazily: the release email carries the
	 * thread entry link, and the first thread entry marks it verified (§6.10).
	 */
	replyEmail: string
}

/** In-site thread opened by a release (product doc §6.10). */
export type ThreadStatus = 'open' | 'closed'
export type ThreadSender = 'owner' | 'requester'

/**
 * Thread rows additionally admit 'system' (booking doc §3.3): structured
 * shared-fact records (booking confirmed/canceled) that belong to neither
 * party — they never count toward bothMessaged or the per-party caps.
 */
export type ThreadMessageSender = ThreadSender | 'system'

// ---------------------------------------------------------------------------
// Connection (product doc §6.6): the physical first-class aggregate of one
// encounter's shared facts — request body, intent snapshot, thread — stored
// once in a ConnectionDO under a per-connection DEK (CDEK) with one wrap per
// party. Inbox and Outbox are two read projections of the same object.

/** How the encounter reached the owner (§6.6); intake origins map via
 * `connectionOriginForIntake`, the agent channel arrives as 'agent_call'. */
export type ConnectionOrigin =
	'link_visit' | 'conversation' | 'agent_call' | 'event' | 'import' | 'email_inbound'

/**
 * Product-layer lifecycle (§6.6). NOT a second state machine: the value is a
 * pure projection of the protocol-layer status (IntakeStatus /
 * AgentRequestStatus, see domain/state.ts) plus the two-sided-message test —
 * `connected` exists only after the release thread carries ≥1 real message
 * from EACH side (the intake body and seed/auto rows never count). Before
 * `connected` the product language is always "Encounter".
 */
export type ConnectionState =
	'proposed' | 'screening' | 'declined' | 'approved' | 'connected' | 'closed'

/** The two keyring/projection sides of a connection (§6.6 "每方一行"). */
export type ConnectionRole = 'owner' | 'requester'

/**
 * Structured external request submitted through the public form (product doc
 * §6.2). No agent, no account required. `context` is shaped by the active
 * contract's requiredContextFields.
 */
export interface RequestIntake {
	id: string
	targetUserId: string
	contractId: string
	contractVersion: number
	requestType: IntakeRequestType
	requester: IntakeRequester
	subject: string
	topics: readonly string[]
	/** How the request converged (§6.5); pre-R1 rows default to 'form'. */
	origin: IntakeOrigin
	status: IntakeStatus
	triageBand?: TriageBand
	triageReasons: readonly TriageReason[]
	riskScore?: number
	/** True once the sender proved the reply mailbox by entering the thread. */
	replyVerified: boolean
	aiTriaged: boolean
	/** Owner marked a released item a mistake, or a declined item a false positive. */
	feedback?: 'false_positive' | 'false_negative'
	createdAt: number
	updatedAt: number
}

export interface AuthContext {
	userId: string
	agentId?: string
	clientId?: string
	scopes: readonly Scope[]
	/**
	 * Whether the presented token authenticates a human owner session or an
	 * autonomous agent. Defaults to 'agent' for legacy tokens (fail closed).
	 */
	actorKind: ActorKind
	/** For delegate-seat tokens (Max), the owner userId being assisted. */
	delegateOf?: string
	/**
	 * For delegate-seat tokens, the seat's own identity (`seat_*`). Data access
	 * resolves to the owner (userId), but audit events are stamped with this so a
	 * seat's actions stay independently attributable (§12.8).
	 */
	seatId?: string
	sessionId?: string
	authTime?: number
	/**
	 * For human sessions: ISO timestamp until which the session counts as
	 * recently re-verified (product doc §12.8 step-up). Absent or in the past
	 * means high-sensitivity operations must request a fresh step-up first.
	 */
	stepUpUntil?: number
	/**
	 * For stateless CWT sessions: the per-user auth generation embedded at
	 * mint. Compared against the live KV value at refresh time and inside
	 * step-up gates, so account recovery / "sign out everywhere" can kill
	 * outstanding tokens without a per-request storage read.
	 */
	sessionGen?: number
	riskLevel: RiskLevel
}

export interface RelationshipPolicySnapshot {
	relationshipId?: string
	state: RelationshipState
	trustLevel: TrustLevel
	temperature: number
	permissions?: readonly RelationshipPermission[]
	topics?: readonly string[]
	sensitivity?: Sensitivity
}

export interface PolicyResource {
	relationship?: RelationshipPolicySnapshot
	relationshipId?: string
	targetUserId?: string
	topic?: string
	topics?: readonly string[]
	requestType?: RequestType
	messageDraft?: string
	proposedDurationMinutes?: number
	idempotencyKey?: string
	includesSecondDegreePath?: boolean
	bulkCount?: number
}

export interface PolicyContext {
	relationshipTemperature?: number
	trustLevel?: TrustLevel
	lastInteractionDays?: number
	frequency30d?: number
	messageSensitivity?: Sensitivity
	containsSensitiveInfo?: boolean
	requestedSensitiveFields?: boolean
	graphSearchBreadth?: number
	agentReputationRisk?: number
	now?: string
}

export interface PolicyInput {
	actor: AuthContext
	action: ToolAction
	resource?: PolicyResource
	context?: PolicyContext
}

export interface RequiredApproval {
	approvalType: string
	expiresInMinutes: number
}

export interface PolicyDecision {
	status: DecisionStatus
	riskScore: number
	redactions: readonly Redaction[]
	reasonCodes: readonly ReasonCode[]
	requiredApproval?: RequiredApproval
	allowedActions: readonly ToolAction[]
}

export interface AuditEventInput {
	traceId: string
	actorType: ActorType
	actorId?: string
	action: string
	resourceType?: string
	resourceId?: string
	decision?: DecisionStatus
	ipHash?: string
	userAgentHash?: string
	detailR2Key?: string
	createdAt?: number
}

export interface AuditEvent extends Required<
	Pick<AuditEventInput, 'traceId' | 'actorType' | 'action'>
> {
	id: string
	actorId?: string
	resourceType?: string
	resourceId?: string
	decision?: DecisionStatus
	ipHash?: string
	userAgentHash?: string
	detailR2Key?: string
	/** Per-user hash-chain position; 1 for the first event (product doc §12.6). */
	chainSeq?: number
	/** Hash of the previous event on this user's chain (empty for the first). */
	prevHash?: string
	/** Content hash of this event, chaining `prevHash`. */
	eventHash?: string
	createdAt: number
}

export interface AuditChainLink {
	chainSeq: number
	prevHash: string
	eventHash: string
}

export interface SuccessEnvelope<TData> {
	ok: true
	traceId: string
	decision?: PolicyDecision
	data: TData
	warnings: readonly string[]
	nextActions: readonly JsonValue[]
}

export interface ErrorEnvelope {
	ok: false
	traceId: string
	error: {
		code: string
		message: string
		retryable: boolean
	}
}

export type CoreEnvelope<TData> = SuccessEnvelope<TData> | ErrorEnvelope
