/**
 * Material Locker domain (docs/alink-material-locker.md): the pure vocabulary
 * for「资料领取柜」— files a user uploads once and hands out through the
 * gatekeeper as short-lived, revocable, audited grants.
 *
 * Two invariants anchor everything here (doc §1.3, locked by tests):
 * · INV-B2-1 — file bytes and downloadable URLs never appear on any unsigned
 *   public surface; converse assembles catalog ENTRIES only, and the model
 *   never touches a signed token (the server mints grants out-of-band).
 * · INV-B2-2 — revocation gates every NEW download: each click on
 *   /locker/:token is arbitrated by the owner's UserDO in one transaction
 *   before a short-lived (minutes) presigned R2 GET is minted for that one
 *   click. A revoked grant never mints again; the only residual exposure is
 *   the already-minted URL's ≤5-minute TTL.
 */
import { isValidXid } from './ids.js'
import { sniffImage, type ImageInfo } from './image.js'
import type { BookingSystemEvent } from './scheduling.js'
import { parseSettlementSystemEvent, type SettlementSystemEvent } from './settlement.js'
import type { IntakeRequestType } from './types.js'

// ---------------------------------------------------------------------------
// Enums + limits

/**
 * 发放面 (doc §3): who a material may reach.
 *
 * `public` (DP-B2-6) is the only tier a visitor can reach WITHOUT a
 * conversation — a published document, not a hand-out. It costs the ledger's
 * per-person attribution and nothing else: every click still passes the same
 * single-point arbitration, and a disable still kills the next click instantly
 * (INV-B2-2 unchanged). Ordered loosest-first so the list reads as a ramp.
 */
export const LOCKER_AUDIENCES = ['public', 'open', 'released', 'manual'] as const
export type LockerAudience = (typeof LOCKER_AUDIENCES)[number]

export function isLockerAudience(value: unknown): value is LockerAudience {
	return typeof value === 'string' && (LOCKER_AUDIENCES as readonly string[]).includes(value)
}

/** How a grant came to exist (doc §7 origin 取值域). */
export const LOCKER_GRANT_ORIGINS = [
	'release_default',
	'release_explicit',
	'thread_deal',
	'converse_auto',
	'outbound_submit'
] as const
export type LockerGrantOrigin = (typeof LOCKER_GRANT_ORIGINS)[number]

export type LockerMaterialStatus = 'active' | 'disabled' | 'deleted'
/** `expired` is a sweep-time bookkeeping stamp — validity is always decided at
 * download time (INV-B2-2), never by the stamp. */
export type LockerGrantStatus = 'issued' | 'revoked' | 'expired'

/** Declared fields an `open`-audience material may require before a converse
 * grant (doc §3.1) — presence-checked only, never verified (DP-B2-1). */
export const LOCKER_REQUIRED_FIELDS = ['name', 'org', 'email', 'purpose'] as const
export type LockerRequiredField = (typeof LOCKER_REQUIRED_FIELDS)[number]

export const LOCKER_LIMITS = {
	/** Signed-link TTL bounds/default in hours (doc §3.1). */
	ttlHoursMin: 1,
	ttlHoursMax: 168,
	ttlHoursDefault: 72,
	/** Per-grant download-count bounds/default (multi-device slack, §3.1). */
	maxDownloadsMin: 1,
	maxDownloadsMax: 20,
	maxDownloadsDefault: 5,
	/** Outbound attachments (§3.7): longer TTL to cover the intake's normal
	 * processing cycle, and a hard cap per submit. */
	outboundTtlMs: 14 * 86_400_000,
	outboundMaxAttachments: 3,
	/** converse 自动发放频度防线 (§3.5). The daily budget default lives in
	 * flags:locker (operator-tunable); these two are structural. */
	conversePerMaterialPerSession: 1,
	conversePerSession: 2,
	/** Ceiling on the public catalog a card page renders (§3.1a). Far above any
	 * plan's `lockerPublicFiles`; it exists so a stale/over-quota row set can
	 * never turn the files room into an unbounded list. */
	publicCatalogMax: 24,
	titleMaxChars: 120,
	descriptionMaxChars: 500,
	filenameMaxChars: 120,
	/** Text (markdown) files stay small (DP-B2-3). */
	markdownMaxBytes: 2 * 1024 * 1024,
	/** Operator ceiling on any single file; the per-plan entitlement caps below it. */
	maxFileBytesCeiling: 25 * 1024 * 1024
} as const

// ---------------------------------------------------------------------------
// Direct-to-R2 transfer windows (presigned refactor, doc §4/§6): bytes move
// straight between the client and LOCKER_BUCKET; the Worker only mints the
// short-lived signed URLs.

/** Presigned PUT lifetime: long enough for a 25MB upload on a slow link. */
export const LOCKER_UPLOAD_URL_TTL_SECONDS = 900
/** Presigned GET lifetime — the INV-B2-2 residual-exposure window: a revoked
 * grant's already-minted URL dies within this many seconds. */
export const LOCKER_DOWNLOAD_URL_TTL_SECONDS = 300
/**
 * Commit must reference an object uploaded within this window. Together with
 * the UserDO cleanup grace (2h) this keeps in-flight uploads and the orphan
 * reaper disjoint: prepare pre-registers the key for cleanup, commit clears
 * it, and the sweep only ever deletes keys whose ticket is long dead.
 */
export const LOCKER_COMMIT_MAX_AGE_MS = 3_600_000

// ---------------------------------------------------------------------------
// File types (DP-B2-3 whitelist, DP-B2-7 paid any-type lane).
//
// Two lanes, chosen by the caller's plan:
// · Whitelist lane (Free/Plus) — PDF + PNG/JPEG/WebP + UTF-8 markdown. A
//   stranger's first upload is the malware-distribution surface (§5 表首), and
//   an unpaid account is the cheap, disposable end of it.
// · Any-type lane (Pro/Max, DP-B2-7) — every extension is admitted and pinned
//   as opaque bytes. What holds the threat model is NOT the type list: bytes
//   leave from r2.cloudflarestorage.com under a signed
//   `response-content-disposition: attachment` the client cannot strip, so
//   nothing renders anywhere, least of all on al.ink. The whitelist was only
//   ever the cheap half; the durable half is the paywall's real-name payment
//   trail, the per-download audit, revocation, and the kill switch.
//
// With direct-to-R2 uploads the Worker never sees the bytes, so admission is
// by DECLARED extension (below) and the pinned presigned Content-Type;
// byte-level verification (magic sniff, metadata strip, markdown UTF-8) is
// the future async post-upload scan's job (doc B2-c 前置) — sniffLockerFile
// and friends stay here as its building blocks.

/** Canonical extension → stored/pinned content type. Anything else is rejected
 * at prepare time on the whitelist lane, and pinned opaque on the any-type one. */
const LOCKER_EXT_ALIASES: Record<string, string> = {
	pdf: 'pdf',
	png: 'png',
	jpg: 'jpg',
	jpeg: 'jpg',
	webp: 'webp',
	md: 'md',
	markdown: 'md'
}

const LOCKER_EXT_TYPES: Record<string, string> = {
	pdf: 'application/pdf',
	png: 'image/png',
	jpg: 'image/jpeg',
	webp: 'image/webp',
	md: 'text/markdown; charset=utf-8'
}

/** Pinned type for anything off the whitelist: opaque bytes, so no browser
 * anywhere has a reason to render it. */
export const LOCKER_OPAQUE_CONTENT_TYPE = 'application/octet-stream'
/** Key extension for a file whose name carries none the key grammar accepts. */
const LOCKER_OPAQUE_EXT = 'bin'

export interface LockerUploadKind {
	/** Canonical server-chosen extension (jpeg→jpg, markdown→md). */
	ext: string
	/** The content type pinned into the presigned PUT and stored on the row. */
	contentType: string
}

/** True for the DP-B2-3 whitelist's canonical extensions — the lane that needs
 * no plan. Takes a canonical ext (post-alias), which is what keys carry. */
export function isLockerWhitelistExt(ext: string): boolean {
	return Object.hasOwn(LOCKER_EXT_TYPES, ext)
}

/**
 * Admit-or-reject by declared filename extension (DP-B2-3 / DP-B2-7, presigned
 * form). With `anyType` the whitelist stops being a gate and becomes a lookup:
 * known extensions keep their real content type (a PDF stays a PDF in the
 * catalog and on the download), everything else is pinned opaque. Null only
 * when the whitelist lane is in force and the extension is off it.
 */
export function lockerUploadKind(
	filename: string | null | undefined,
	options: { anyType?: boolean } = {}
): LockerUploadKind | null {
	const match = /\.([A-Za-z0-9]{1,12})$/.exec((filename ?? '').trim())
	const declared = match ? match[1].toLowerCase() : null
	// ⚠️ hasOwn, never a bare index: `constructor` matches the extension grammar
	// and would otherwise resolve up the prototype chain to a truthy FUNCTION —
	// which sails past the whitelist rejection and lands in the object key.
	const ext =
		declared && Object.hasOwn(LOCKER_EXT_ALIASES, declared)
			? LOCKER_EXT_ALIASES[declared]
			: undefined
	if (ext) return { ext, contentType: LOCKER_EXT_TYPES[ext] }
	if (!options.anyType) return null
	// The declared extension survives only as a label the key grammar bounds
	// (lowercase alnum ≤12); a name carrying none downloads as `.bin`.
	return { ext: declared ?? LOCKER_OPAQUE_EXT, contentType: LOCKER_OPAQUE_CONTENT_TYPE }
}

// ---------------------------------------------------------------------------
// Object keys: `locker/{userId}/` is the §12.9 erasure prefix; the material
// segment keeps replace/delete free of cross-material shared-key hazards; the
// random segment gives every upload/replace a fresh key (no sha256 — the
// server never sees the bytes). Commit echoes the prepared key back, so the
// parse re-derives ownership instead of trusting the client.

export function buildLockerObjectKey(
	userId: string,
	materialId: string,
	ext: string,
	randomHex16: string
): string {
	return `locker/${userId}/${materialId}/${randomHex16}.${ext}`
}

export interface LockerObjectKeyParts {
	userId: string
	materialId: string
	ext: string
}

export function parseLockerObjectKey(key: unknown): LockerObjectKeyParts | null {
	if (typeof key !== 'string' || key.length > 200) return null
	const segments = key.split('/')
	if (segments.length !== 4 || segments[0] !== 'locker') return null
	const [, userId, materialId, file] = segments
	if (!isValidXid(userId)) return null
	if (!/^mat_[A-Za-z0-9]{10,40}$/.test(materialId)) return null
	const fileMatch = /^([0-9a-f]{16})\.([a-z0-9]{1,12})$/.exec(file)
	if (!fileMatch) return null
	// ⚠️ The extension is bounded by the grammar, NOT checked against the
	// whitelist: since DP-B2-7 a key may legitimately carry any extension. Which
	// lane a key was admitted under is a plan question, so commit re-asks it
	// (services/locker.ts verifyCommittedObject) rather than inferring it here —
	// a Pro key must not stay committable after a downgrade.
	return { userId, materialId, ext: fileMatch[2] }
}

/** Content type for a canonical extension — the whitelist's when it has one,
 * opaque bytes otherwise (DP-B2-7). */
export function lockerContentTypeForExt(ext: string): string {
	// hasOwn for the same reason as lockerUploadKind: a bare index would hand
	// back Object.prototype.constructor for the ext `constructor`.
	return isLockerWhitelistExt(ext) ? LOCKER_EXT_TYPES[ext] : LOCKER_OPAQUE_CONTENT_TYPE
}

/** RFC 5987/6266 Content-Disposition with a safe ASCII fallback — rides the
 * presigned GET as the signed `response-content-disposition` override. */
export function lockerContentDisposition(filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
	const encoded = encodeURIComponent(filename).replace(
		/['()*]/g,
		(ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
	)
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

export interface LockerFileInfo {
	kind: 'pdf' | 'image' | 'markdown'
	contentType: string
	/** Server-derived extension — the client's claimed extension is never trusted. */
	ext: string
	/** Present for images: feeds the existing strip/animation pipeline. */
	image?: ImageInfo
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"

function hasPdfMagic(bytes: Uint8Array): boolean {
	if (bytes.byteLength < PDF_MAGIC.length) return false
	return PDF_MAGIC.every((byte, index) => bytes[index] === byte)
}

/**
 * Strict UTF-8 text check for the markdown lane: decodable with a fatal
 * decoder AND free of NUL/control characters (tab/newline/CR allowed). A
 * binary smuggled under a .md name fails here.
 */
export function isValidMarkdownText(bytes: Uint8Array): boolean {
	if (bytes.byteLength === 0 || bytes.byteLength > LOCKER_LIMITS.markdownMaxBytes) return false
	let text: string
	try {
		text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
	} catch {
		return false
	}
	// eslint-disable-next-line no-control-regex
	return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)
}

function declaredMarkdownName(name: string | null | undefined): boolean {
	if (!name) return false
	const lower = name.trim().toLowerCase()
	return lower.endsWith('.md') || lower.endsWith('.markdown')
}

/**
 * Admit-or-reject for the upload pipeline (doc §6). Returns null for anything
 * outside the DP-B2-3 whitelist; the caller maps null to VALIDATION_FAILED.
 */
export function sniffLockerFile(
	bytes: Uint8Array,
	declaredFilename: string | null | undefined
): LockerFileInfo | null {
	if (bytes.byteLength === 0) return null
	if (hasPdfMagic(bytes)) {
		return { kind: 'pdf', contentType: 'application/pdf', ext: 'pdf' }
	}
	const image = sniffImage(bytes)
	if (image) {
		return { kind: 'image', contentType: image.contentType, ext: image.ext, image }
	}
	if (declaredMarkdownName(declaredFilename) && isValidMarkdownText(bytes)) {
		return { kind: 'markdown', contentType: 'text/markdown; charset=utf-8', ext: 'md' }
	}
	return null
}

/**
 * Drop unpaired UTF-16 surrogates. JSON.parse admits them ("\ud800" is valid
 * JSON), but encodeURIComponent throws URIError on one — a stored lone
 * surrogate in a filename would crash lockerContentDisposition at download
 * time, AFTER arbitration consumed the click. Applied post-slice too, since
 * slicing can split a well-formed pair at the length boundary.
 */
function dropLoneSurrogates(value: string): string {
	return value.replace(
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
		''
	)
}

/**
 * Download filename: strip path segments and unsafe characters, bound the
 * length, and force the extension from the server-verified content type —
 * never from the client's claim (doc §6). Unicode letters survive (中文文件名
 * are legitimate); control chars, separators and header-hostile chars do not.
 */
export function sanitizeLockerFilename(raw: string | null | undefined, ext: string): string {
	const base = (raw ?? '')
		.split(/[/\\]/)
		.pop()!
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001F\u007F"*:<>?|]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\.[A-Za-z0-9]{1,12}$/, '')
		.replace(/[.\s]+$/, '')
	const stem =
		dropLoneSurrogates(base.slice(0, LOCKER_LIMITS.filenameMaxChars - ext.length - 1)) || 'file'
	return `${stem}.${ext}`
}

// ---------------------------------------------------------------------------
// Rule validation (owner PATCH payloads)

export interface LockerRules {
	title: string
	description: string
	audience: LockerAudience
	requestTypes: IntakeRequestType[]
	requiredFields: LockerRequiredField[]
	ttlHours: number
	maxDownloads: number
}

export function clampLockerTtlHours(value: unknown): number {
	const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN
	if (!Number.isFinite(n)) return LOCKER_LIMITS.ttlHoursDefault
	return Math.min(LOCKER_LIMITS.ttlHoursMax, Math.max(LOCKER_LIMITS.ttlHoursMin, n))
}

export function clampLockerMaxDownloads(value: unknown): number {
	const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN
	if (!Number.isFinite(n)) return LOCKER_LIMITS.maxDownloadsDefault
	return Math.min(LOCKER_LIMITS.maxDownloadsMax, Math.max(LOCKER_LIMITS.maxDownloadsMin, n))
}

/** Strip control chars and bound length for the visitor-visible text fields
 * (title/description are public UGC — they enter the converse catalog). The
 * length slice can split a surrogate pair, so lone surrogates are dropped last. */
export function sanitizeLockerText(raw: unknown, maxChars: number): string {
	if (typeof raw !== 'string') return ''
	return dropLoneSurrogates(
		raw
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u001F\u007F]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, maxChars)
	)
}

// ---------------------------------------------------------------------------
// Signed grant token (doc §4). Format: `{ownerXid}.{grantId}.{expBase36}.{sig}`
// — every segment is lowercase by construction, so the whole token survives
// MTA/IM case-mangling (the E1 hex-over-base64url lesson); parse re-lowercases
// defensively. Sig = HMAC-SHA-256 over `alink-locker:{grantId}:{ownerXid}:
// {expiresAt}` under the dedicated HKDF purpose 'locker-grant' (its own trust
// domain, the referral-intro convention). Signature verification lives in the
// service layer (needs env); this is the pure encode/parse half.

export interface LockerTokenParts {
	ownerXid: string
	grantId: string
	expiresAt: number
	sig: string
}

/** Grant ids are 32 lowercase hex chars (UUID-derived, the referral jti
 * convention) — dot-free and case-insensitive-safe inside the token. */
export const LOCKER_GRANT_ID_PATTERN = /^[0-9a-f]{32}$/

const encodeExpiry = (ms: number) => ms.toString(36)
const decodeExpiry = (raw: string) => {
	const value = parseInt(raw, 36)
	return Number.isSafeInteger(value) && value > 0 ? value : null
}

export function encodeLockerToken(parts: LockerTokenParts): string {
	return [parts.ownerXid, parts.grantId, encodeExpiry(parts.expiresAt), parts.sig].join('.')
}

/** Structural parse only — signature verification is the caller's next step. */
export function parseLockerToken(raw: string): LockerTokenParts | null {
	if (typeof raw !== 'string' || raw.length > 200) return null
	const segments = raw.toLowerCase().split('.')
	if (segments.length !== 4) return null
	const [ownerXid, grantId, expiryRaw, sig] = segments
	if (!isValidXid(ownerXid)) return null
	if (!LOCKER_GRANT_ID_PATTERN.test(grantId)) return null
	const expiresAt = decodeExpiry(expiryRaw)
	if (!expiresAt || !/^[0-9a-f]{64}$/.test(sig)) return null
	return { ownerXid, grantId, expiresAt, sig }
}

// ---------------------------------------------------------------------------
// Thread system message (doc §3.3): the grant card is a structured system
// message in the ConnectionDO thread — static identity only, NEVER the token
// (read-time assembly re-derives the signed URL and the live state from the
// material owner's UserDO). `ownerXid` names which side's locker arbitrates,
// so both the owner→requester deal and the §3.7 mirror direction enrich from
// the right DO.

export interface MaterialGrantEvent {
	kind: 'material_grant'
	grantId: string
	materialId: string
	/** The material OWNER (whose UserDO arbitrates downloads). */
	ownerXid: string
	/** Which thread side dealt it (renders left/right + naming). */
	by: 'owner' | 'requester'
	title: string
	contentType: string
	sizeBytes: number
}

export function isMaterialGrantEvent(value: unknown): value is MaterialGrantEvent {
	if (!value || typeof value !== 'object') return false
	const event = value as MaterialGrantEvent
	return (
		event.kind === 'material_grant' &&
		typeof event.grantId === 'string' &&
		typeof event.materialId === 'string' &&
		typeof event.ownerXid === 'string' &&
		(event.by === 'owner' || event.by === 'requester') &&
		typeof event.title === 'string'
	)
}

/**
 * Every structured payload a thread 'system' row may carry.
 *
 * ⚠️ A new kind MUST be added here, not just written by whoever inserts it.
 * `parseThreadSystemEvent` falls through to the booking shape for anything it
 * does not name, and every renderer downstream discriminates on this union —
 * so an unlisted kind does not fail loudly, it renders as a booking event with
 * an undefined `startAt`, which `Intl.DateTimeFormat` happily formats as
 * «today». That is how a settlement card first shipped reading «the meeting
 * was canceled».
 */
export type ThreadSystemEvent = BookingSystemEvent | MaterialGrantEvent | SettlementSystemEvent

/**
 * Read-time enrichment of a grant card (§3.3 领取卡实时状态): live status +
 * remaining downloads + the re-derived signed download path. Assembled fresh
 * on every thread read — never stored (the static system message carries
 * identity only, INV-B2-1).
 */
export interface MaterialGrantBlock {
	grantId: string
	materialId: string
	title: string
	contentType: string
	sizeBytes: number
	status: 'issued' | 'revoked' | 'expired' | 'exhausted'
	expiresAt: number
	downloadsRemaining: number
	/** Present only for live grants AND only on the receiving side's view. */
	downloadPath: string | null
}

/** Superset of parseBookingSystemEvent: discriminates on `kind` and validates
 * the material-grant shape (a malformed row renders as nothing, never raw). */
export function parseThreadSystemEvent(raw: string): ThreadSystemEvent | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== 'object') return null
	const kind = (parsed as { kind?: unknown }).kind
	if (typeof kind !== 'string') return null
	if (kind === 'material_grant') {
		return isMaterialGrantEvent(parsed) ? parsed : null
	}
	if (kind.startsWith('settlement_')) {
		return parseSettlementSystemEvent(raw)
	}
	return parsed as BookingSystemEvent
}
