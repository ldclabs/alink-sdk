import type { Entitlement, HandleClass, Plan } from './types.js'

/** Bumped whenever PLAN_ENTITLEMENTS changes; drives KV cache invalidation.
 * 14: `dutyMode` free at every tier (evidence-plan DP-E8). The bump is what
 * makes it land at all: a cached v13 entitlement says `false` for a Free/Plus
 * account, and without the version change every such owner would keep being
 * told 值守 needs Pro for the whole cache TTL after the deploy.
 * 13: `settlement` (settlement doc §9). Same reason as 12 below — a cached v12
 * entitlement has no such key and `undefined` reads as false, so Pro/Max would
 * be told "结算卡是 Pro 功能" on their own account for the whole cache TTL.
 * 12: `lockerAnyFileType` (material-locker doc DP-B2-7). The bump matters here:
 * a cached v11 entitlement has no such key, and `undefined` reads as "whitelist
 * only" — Pro would keep bouncing .zip for the cache TTL after the deploy.
 * 11: the four `works*` quotas (works doc §8.4, DP-W7).
 * 10: `orgCount` removed — founding is one organization per account at every
 * tier (see the note where the field used to live in domain/types.ts). */
export const ENTITLEMENTS_VERSION = 14

/**
 * Compliance floor for audit retention in days (product doc §13.1): audit
 * events are retained at least this long on every plan regardless of the
 * per-plan `auditVisibleDays` UI window. Retention/cleanup jobs must key off
 * this constant, never off the entitlement's visible-window field.
 */
export const AUDIT_RETENTION_MIN_DAYS = 365

const FREE: Entitlement = {
	plan: 'free',
	handleClassLimit: 'xid',
	aiTriagePerMonth: 50,
	maxRelationships: 100,
	conversationDailyTurns: 30,
	personaCustom: false,
	/**
	 * 值守 is free at every tier, starting here (evidence-plan DP-E8, 2026-08-17
	 * 用户裁决 — it reverses misc/alink-duty-mode-plan-gate.md and the paid half
	 * of duty-mode DP-10).
	 *
	 * The thing a paid gate was charging for is the thing that makes an agent
	 * developer take an address here at all: «my agent has a public front door».
	 * Putting it behind Pro meant the one reader who needed no convincing met a
	 * paywall first. And it costs us nearly nothing: a duty desk answers with
	 * ITS OWN model, and the 60-second fallback runs on alink's representative,
	 * whose budget every plan already carries as its conversation quota.
	 *
	 * ⚠️ This does NOT open the second gate. Duty still requires an agent-held
	 * account (`principal_type: 'agent'`, duty.ts requireDutyOpen) — that one is
	 * protective, not commercial: a person's visitors were told their words stay
	 * invisible to that person.
	 */
	dutyMode: true,
	assistantBriefEntries: 8,
	signalsDepth: 'counts',
	maxActiveIntents: 5,
	discoveryDailySearches: 5,
	auditVisibleDays: 30,
	requestRetentionDays: 90,
	delegateSeats: 0,
	customContract: false,
	multiContract: false,
	aiFollowup: false,
	autoArrange: false,
	settlement: false,
	materialLocker: false,
	lockerAnyFileType: false,
	lockerMaxFiles: 5,
	lockerMaxTotalBytes: 50 * 1024 * 1024,
	lockerMaxFileBytes: 10 * 1024 * 1024,
	lockerPublicFiles: 1,
	intentForms: 0,
	worksMaxCount: 5,
	worksMaxFileBytes: 5 * 1024 * 1024,
	worksMaxFilesPerWork: 10,
	worksMaxTotalBytes: 50 * 1024 * 1024,
	orgActiveMembers: 5,
	orgApprovalPolicies: 0,
	valueReport: 'none',
	removeBranding: false,
	version: ENTITLEMENTS_VERSION
}

const PLUS: Entitlement = {
	plan: 'plus',
	handleClassLimit: 'standard',
	aiTriagePerMonth: 500,
	maxRelationships: 1_000,
	conversationDailyTurns: 100,
	personaCustom: true,
	// Free at every tier — see the note on FREE (evidence-plan DP-E8).
	dutyMode: true,
	assistantBriefEntries: 24,
	signalsDepth: 'identity',
	maxActiveIntents: 10,
	discoveryDailySearches: 30,
	auditVisibleDays: 90,
	requestRetentionDays: 180,
	delegateSeats: 0,
	customContract: true,
	multiContract: false,
	aiFollowup: true,
	autoArrange: false,
	settlement: false,
	materialLocker: false,
	lockerAnyFileType: false,
	lockerMaxFiles: 50,
	lockerMaxTotalBytes: 500 * 1024 * 1024,
	lockerMaxFileBytes: 10 * 1024 * 1024,
	lockerPublicFiles: 10,
	// One live form: 「发起一次征集」 as a tangible upgrade motive (DP-F-4).
	intentForms: 1,
	worksMaxCount: 20,
	worksMaxFileBytes: 10 * 1024 * 1024,
	worksMaxFilesPerWork: 10,
	worksMaxTotalBytes: 500 * 1024 * 1024,
	orgActiveMembers: 10,
	orgApprovalPolicies: 0,
	valueReport: 'monthly',
	removeBranding: false,
	version: ENTITLEMENTS_VERSION
}

const PRO: Entitlement = {
	plan: 'pro',
	handleClassLimit: 'compact',
	aiTriagePerMonth: 10_000,
	maxRelationships: 5_000,
	conversationDailyTurns: 300,
	personaCustom: true,
	dutyMode: true,
	assistantBriefEntries: 24,
	signalsDepth: 'timeline',
	// Fair-use ceiling, not a sales tier: most users hold 1–2 active intents
	// (commercialization doc §2.3), so Pro/Max never feel this cap.
	maxActiveIntents: 100,
	discoveryDailySearches: 100,
	auditVisibleDays: 365,
	requestRetentionDays: 180,
	delegateSeats: 0,
	customContract: true,
	multiContract: true,
	aiFollowup: true,
	autoArrange: true,
	settlement: true,
	materialLocker: true,
	// DP-B2-7: the type whitelist lifts where a real-name payment trail begins.
	lockerAnyFileType: true,
	lockerMaxFiles: 100,
	lockerMaxTotalBytes: 5 * 1024 * 1024 * 1024,
	lockerMaxFileBytes: 500 * 1024 * 1024,
	lockerPublicFiles: 50,
	// "Unlimited" in effect: live forms can never exceed maxActiveIntents.
	intentForms: 100,
	worksMaxCount: 100,
	worksMaxFileBytes: 500 * 1024 * 1024,
	worksMaxFilesPerWork: 50,
	worksMaxTotalBytes: 5 * 1024 * 1024 * 1024,
	orgActiveMembers: 50,
	orgApprovalPolicies: 10,
	valueReport: 'weekly',
	removeBranding: true,
	version: ENTITLEMENTS_VERSION
}

const MAX: Entitlement = {
	plan: 'max',
	handleClassLimit: 'short',
	aiTriagePerMonth: 30_000,
	maxRelationships: 10_000,
	conversationDailyTurns: 600,
	personaCustom: true,
	dutyMode: true,
	assistantBriefEntries: 24,
	signalsDepth: 'timeline',
	maxActiveIntents: 100,
	discoveryDailySearches: 300,
	auditVisibleDays: 365,
	requestRetentionDays: 180,
	delegateSeats: 1,
	customContract: true,
	multiContract: true,
	aiFollowup: true,
	autoArrange: true,
	settlement: true,
	materialLocker: true,
	lockerAnyFileType: true,
	lockerMaxFiles: 1000,
	lockerMaxTotalBytes: 100 * 1024 * 1024 * 1024,
	lockerMaxFileBytes: 1 * 1024 * 1024 * 1024,
	lockerPublicFiles: 100,
	intentForms: 100,
	worksMaxCount: 1000,
	worksMaxFileBytes: 1 * 1024 * 1024 * 1024,
	worksMaxFilesPerWork: 100,
	worksMaxTotalBytes: 100 * 1024 * 1024 * 1024,
	orgActiveMembers: 100,
	orgApprovalPolicies: 50,
	valueReport: 'weekly',
	removeBranding: true,
	version: ENTITLEMENTS_VERSION
}

/**
 * Static entitlement matrix (commercialization doc §2.1). Quotas and prices
 * are v0 hypotheses adjustable via feature flags. Organization plans arrive
 * with the future org model, not on this per-account plan enum.
 */
export const PLAN_ENTITLEMENTS: Record<Plan, Entitlement> = {
	free: FREE,
	plus: PLUS,
	pro: PRO,
	max: MAX
}

export function entitlementForPlan(plan: Plan): Entitlement {
	return PLAN_ENTITLEMENTS[plan]
}

/**
 * Dunning degrade (commercialization doc §5.4, D8–D30): the AI quotas and the
 * paid depth surfaces fall to the free tier — never below it (欠费不噤声:
 * conversation keeps at least the free quota), and never above it for the
 * degraded set, regardless of operator overrides. Everything else keeps the
 * plan level — protection never goes offline. This field list IS the §5.4
 * policy; extend it here when a new paid-depth surface joins the ladder.
 */
export function degradeToFreeTier(entitlement: Entitlement): Entitlement {
	const free = PLAN_ENTITLEMENTS.free
	return {
		...entitlement,
		aiTriagePerMonth: Math.min(entitlement.aiTriagePerMonth, free.aiTriagePerMonth),
		conversationDailyTurns: Math.min(
			entitlement.conversationDailyTurns,
			free.conversationDailyTurns
		),
		personaCustom: free.personaCustom,
		// 值守 no longer pauses while past-due, and this line is why it doesn't:
		// the free tier now carries it (DP-E8), so degrading TO the free tier
		// leaves the door where it is. DP-P5 「欠费值守暂停」 is void with it —
		// deliberately not written as an explicit `true`, because the rule this
		// function encodes is «fall to the free tier», and the free tier is the
		// single place that decides what 值守 costs.
		dutyMode: free.dutyMode,
		signalsDepth: free.signalsDepth,
		// Booking slots pause while past-due (booking doc §3.1 欠费降级即暂停);
		// confirmed bookings are untouched — only new offers/config stop.
		autoArrange: free.autoArrange,
		// Settlement pauses the same way (settlement doc §9): the owner cannot
		// issue NEW cards while past-due. Already-issued cards keep rendering and
		// keep accepting both sides' marks — the mark path never consults the
		// plan. Locking the payer out over the OWNER's billing would strand money
		// mid-flight, and alink is not in that flow to begin with (INV-3).
		settlement: free.settlement,
		// Material locker pauses the same way (material-locker doc §10): the
		// receive side closes and the quotas fall to the free tier, which stops
		// new uploads/grants for anyone stocked past it — while already-issued
		// links keep downloading inside their TTL (the download route never
		// consults the plan, only the grant ledger).
		materialLocker: free.materialLocker,
		// The any-type lane pauses with it (DP-B2-7): what the paywall buys is a
		// CURRENT payment trail, so a delinquent account uploads on the whitelist
		// like any other unpaid one. Already-stored files are untouched — they
		// keep listing and downloading, since neither path consults the plan.
		lockerAnyFileType: free.lockerAnyFileType,
		lockerMaxFiles: Math.min(entitlement.lockerMaxFiles, free.lockerMaxFiles),
		lockerPublicFiles: Math.min(entitlement.lockerPublicFiles, free.lockerPublicFiles),
		lockerMaxTotalBytes: Math.min(entitlement.lockerMaxTotalBytes, free.lockerMaxTotalBytes),
		lockerMaxFileBytes: Math.min(entitlement.lockerMaxFileBytes, free.lockerMaxFileBytes),
		// Intent forms close their receive surface while past-due (doc DP-F-4):
		// submits fall back to the generic form; the intent card keeps rendering.
		intentForms: Math.min(entitlement.intentForms, free.intentForms)
		// ⚠️ The four `works*` quotas are absent ON PURPOSE (works doc §8.4
		// 降档语义). Clamping them would not un-publish anything — the read path
		// never consults the plan — but it WOULD be the wrong promise to encode:
		// what a lapsed plan closes is publishing NEW works, and that gate lives
		// at prepare/commit, where it can say so. A reader's link never dies
		// because the author stopped paying (身份连续性 > 收入, PRD §18).
		// ⚠️ `orgActiveMembers` / `orgApprovalPolicies` are absent from this list
		// ON PURPOSE (collaboration doc §45.1, WP-K4). An organization is an
		// IDENTITY: degrading its member ceiling would either eject people who
		// joined in good faith or silently invalidate the grants they hold, and
		// 「身份连续性 > 收入」 settles that. A past-due account keeps its
		// organizations exactly as they are; what a lapsed plan closes is the
		// FOUNDING side, which is gated at the create path.
		//
		// `orgCount` is not here either, because it no longer exists: founding is
		// one organization per account on every tier (domain/types.ts explains
		// why — the handle namespace, not the member ceiling).
	}
}

// Subscription-bindable classes only: xid is system-issued and free, premium
// is invite/auction only (commercialization doc §3.4) — neither binds via a
// plan's handleClassLimit.
const BINDABLE_CLASS_RANK: Partial<Record<HandleClass, number>> = {
	standard: 1,
	compact: 2,
	short: 3
}

/**
 * Whether a plan whose limit is `limit` may bind a custom handle of class
 * `cls`. Higher tiers may bind every class below their limit (§3.1).
 */
export function canBindHandleClass(limit: HandleClass, cls: HandleClass): boolean {
	const limitRank = BINDABLE_CLASS_RANK[limit]
	const clsRank = BINDABLE_CLASS_RANK[cls]
	if (limitRank === undefined || clsRank === undefined) return false
	return clsRank <= limitRank
}
