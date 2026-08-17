/**
 * Works domain (docs/alink-works.md): 房间四 — the pure vocabulary for 作品,
 * the bundles a person (or their AI) publishes under their own identity.
 *
 * A work is a BUNDLE (§8.1, DP-W15): one entry `index.html` plus relative
 * assets, addressed by a version directory whose name is the hash of the whole
 * manifest. Change one byte of one file and you get a new versionId, hence a
 * new URL tree — which is what makes caching, takedown and 内容不可静默篡改
 * all fall out of addressing rather than out of bookkeeping.
 *
 * Three invariants anchor everything here (doc §6, locked by tests):
 * · INV-W1 — 异源: work bytes are served ONLY from works.al.ink, never inlined
 *   into an al.ink page.
 * · INV-W2 — 双层沙箱: the document is an opaque origin however it is reached
 *   (iframe `sandbox` attribute AND the server's `Content-Security-Policy:
 *   sandbox` header), so a forwarded bare link is as caged as an embed.
 * · INV-W3 — 出口白名单: whatever a visitor types inside a work can reach no
 *   third party and no writable endpoint. `form-action 'none'`,
 *   `frame-src 'none'`, and a `connect-src` naming only the read-only bundle
 *   origin. The named-CDN lane never touches any of those three (§6.3).
 */
import { isValidXid } from './ids.js'

// ---------------------------------------------------------------------------
// Enums

/**
 * §4.2 状态语义. `published` enters the room and the in-set prev/next cycle;
 * `unlisted` is reachable by direct link only (bytes serve, the catalog does
 * not list it); `draft` and `blocked` are 404 to visitors. `blocked` is the
 * governance-only value — an owner sees it and its reason but cannot clear it.
 */
export const WORK_STATUSES = ['draft', 'published', 'unlisted', 'blocked'] as const
export type WorkStatus = (typeof WORK_STATUSES)[number]

export function isWorkStatus(value: unknown): value is WorkStatus {
	return typeof value === 'string' && (WORK_STATUSES as readonly string[]).includes(value)
}

/** Statuses whose bytes are served (§9.3: the KV projection exists for both). */
export function workBytesVisible(status: WorkStatus): boolean {
	return status === 'published' || status === 'unlisted'
}

/** Who published it (§5.1 来源徽章): the console, or an agent over MCP. The
 * owner sees which, on every row — 「这件是 AI 发的」 is a fact they are owed. */
export const WORK_SOURCES = ['console', 'mcp'] as const
export type WorkSource = (typeof WORK_SOURCES)[number]

export function isWorkSource(value: unknown): value is WorkSource {
	return typeof value === 'string' && (WORK_SOURCES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Limits

export const WORK_LIMITS = {
	titleMaxChars: 120,
	summaryMaxChars: 300,
	/** Bounded like every other public list (locker's publicCatalogMax 范式): a
	 * stale or over-quota row set can never turn the room into an endless grid. */
	catalogMax: 500,
	/** Path segment depth inside a bundle, entry file included (§8.1). */
	maxPathDepth: 5,
	/** Whole-path ceiling; R2 keys stay far below any limit with this. */
	maxPathChars: 180,
	/** The one entry point. No index means no work (§8.1: commit refuses). */
	entryPath: 'index.html',
	/** Bytes of the entry file that commit sniffs — enough to see a `<`, far too
	 * few to parse. The sandbox is the defence; this only catches a slip. */
	entryProbeBytes: 512,
	slugMaxChars: 64
} as const

/** Presigned PUT lifetime — one per bundle file, all minted together (§8.2). */
export const WORK_UPLOAD_URL_TTL_SECONDS = 900
/**
 * Commit must reference objects uploaded within this window. With the UserDO
 * cleanup grace (2h) this keeps in-flight uploads and the orphan reaper
 * disjoint, exactly as the locker does: prepare pre-registers every key,
 * commit clears them, and the sweep only deletes keys whose ticket is dead.
 */
export const WORK_COMMIT_MAX_AGE_MS = 3_600_000
/** Draft preview links (§9.3 `?pv=`): short enough that a leaked URL dies. */
export const WORK_PREVIEW_TTL_MS = 600_000
/** Edge TTL for a bundle's HTML — the takedown propagation window (§6.6 时效). */
export const WORK_HTML_CACHE_CONTROL = 'public, max-age=300'
/** Assets live under an immutable version directory, so they cache hard. The
 * entry above does not: every takedown decision is re-made on the HTML fetch
 * and on the KV read, and an asset with no entry to reach it is unreachable. */
export const WORK_ASSET_CACHE_CONTROL = 'public, max-age=86400, immutable'

// ---------------------------------------------------------------------------
// Extension whitelist (§8.1). The server pins content-type from the extension
// and NEVER trusts what the uploader declares — the locker discipline, applied
// to a bundle. Anything not here is refused at prepare time, which is also
// what keeps archives out (a zip is unpacked in the browser, never here).

const WORK_EXT_TYPES: Record<string, string> = {
	// markup / code / data
	html: 'text/html; charset=utf-8',
	css: 'text/css; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	json: 'application/json; charset=utf-8',
	txt: 'text/plain; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
	xml: 'application/xml; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	wasm: 'application/wasm',
	pdf: 'application/pdf',
	// images
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	ico: 'image/x-icon',
	// An SVG referenced by <img> never executes script, and a bare hit lands
	// under the §6.2 server-side sandbox header like every other path here.
	svg: 'image/svg+xml',
	avif: 'image/avif',
	// audio / video
	mp4: 'video/mp4',
	webm: 'video/webm',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	m4a: 'audio/mp4',
	// fonts
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',
	// 3D / misc payloads
	glb: 'model/gltf-binary',
	gltf: 'model/gltf+json',
	bin: 'application/octet-stream',
	vtt: 'text/vtt; charset=utf-8',
	srt: 'text/plain; charset=utf-8'
}

/** Server-pinned content type for a bundle path, or null when the extension is
 * outside the whitelist. */
export function workContentTypeForPath(path: string): string | null {
	const match = /\.([A-Za-z0-9]{1,8})$/.exec(path)
	if (!match) return null
	return WORK_EXT_TYPES[match[1].toLowerCase()] ?? null
}

/** The whitelisted extensions, for error messages and the console's file input. */
export const WORK_ALLOWED_EXTENSIONS = Object.keys(WORK_EXT_TYPES)

// ---------------------------------------------------------------------------
// Bundle paths (§8.1). Every reference inside a bundle is RELATIVE, which is
// why the platform can promise it rewrites no byte of what you uploaded: a
// relative reference resolves inside the same version directory by
// construction. All this layer has to do is refuse a path that could escape it.

/**
 * Normalize an uploaded path to its canonical bundle form, or null if it may
 * not exist in a bundle at all.
 *
 * Refusals, each for its own reason: backslashes and `..` (escape the version
 * directory), a leading `/` or a drive letter (absolute), a dot-leading
 * segment (`.git/`, `.env` — a folder upload sweeps them up silently), depth
 * or length past the caps, an extension outside the whitelist.
 */
export function normalizeWorkPath(raw: unknown): string | null {
	if (typeof raw !== 'string') return null
	// Browsers hand folder uploads a `webkitRelativePath` rooted at the picked
	// folder ("my-app/index.html"); the console strips that root before it gets
	// here, so anything still leading with a slash is a client that guessed.
	const trimmed = raw.trim().replace(/^\.\//, '')
	if (!trimmed || trimmed.length > WORK_LIMITS.maxPathChars) return null
	if (trimmed.includes('\\') || trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) return null
	const segments = trimmed.split('/')
	if (segments.length > WORK_LIMITS.maxPathDepth) return null
	for (const segment of segments) {
		if (!segment || segment.startsWith('.')) return null
		if (!/^[A-Za-z0-9._-]+$/.test(segment)) return null
	}
	if (!workContentTypeForPath(trimmed)) return null
	return trimmed
}

/** Entry-relative default: a request for the directory (or for nothing) serves
 * `index.html`, the way any static host would. */
export function resolveWorkRequestPath(rawPath: string): string | null {
	const path =
		rawPath === '' || rawPath.endsWith('/') ? `${rawPath}${WORK_LIMITS.entryPath}` : rawPath
	return normalizeWorkPath(path)
}

// ---------------------------------------------------------------------------
// Manifest + version addressing

export interface WorkManifestEntry {
	path: string
	size: number
	/** R2's etag for the stored object — the per-file content fingerprint the
	 * versionId hashes over. Present only AFTER commit HEADs the objects. */
	etag: string
}

/** What the client declares at prepare time: paths and sizes only (the bytes
 * have not moved yet, and the server never trusts a client-computed digest). */
export interface WorkManifestDeclaration {
	path: string
	size: number
}

/**
 * versionId = sha256 over the sorted `(path, size, etag)` triples, 16 hex.
 *
 * Sorted because a bundle is a SET of files: the same files uploaded in a
 * different order are the same version, and must land on the same URL tree.
 * Computed server-side at commit from the HEAD results — the client carries no
 * part of the addressing, so it cannot pin someone else's version directory.
 */
export async function computeWorkVersionId(
	manifest: readonly WorkManifestEntry[]
): Promise<string> {
	const canonical = [...manifest]
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
		.map((entry) => `${entry.path}:${entry.size}:${entry.etag}`)
		.join('\n')
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
	return [...new Uint8Array(digest)]
		.slice(0, 8)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

export function isWorkVersionId(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value)
}

// ---------------------------------------------------------------------------
// Object keys. `works/{userId}/` is the §12.9 erasure prefix (its own sweep,
// alongside the locker's and the media bucket's); the version segment is what
// makes replace an ADD-then-drop rather than an in-place overwrite, so a reader
// mid-load of the old version never sees a half-swapped bundle.

export function buildWorkObjectKey(
	userId: string,
	workId: string,
	versionId: string,
	path: string
): string {
	return `works/${userId}/${workId}/${versionId}/${path}`
}

/** The prefix holding every byte of one version — what replace/delete drops. */
export function workVersionPrefix(userId: string, workId: string, versionId: string): string {
	return `works/${userId}/${workId}/${versionId}/`
}

export interface WorkObjectKeyParts {
	userId: string
	workId: string
	versionId: string
	path: string
}

/**
 * Re-derive ownership FROM THE KEY (locker discipline): commit parses what the
 * client echoed back rather than believing a client-supplied owner, so a
 * forged key can only ever name its forger.
 */
export function parseWorkObjectKey(key: unknown): WorkObjectKeyParts | null {
	if (typeof key !== 'string' || key.length > 300) return null
	const segments = key.split('/')
	if (segments.length < 5 || segments[0] !== 'works') return null
	const [, userId, workId, versionId, ...rest] = segments
	if (!isValidXid(userId)) return null
	if (!/^work_[0-9A-HJKMNP-TV-Z]{26}$/.test(workId)) return null
	if (!isWorkVersionId(versionId)) return null
	const path = normalizeWorkPath(rest.join('/'))
	if (!path) return null
	return { userId, workId, versionId, path }
}

// ---------------------------------------------------------------------------
// Slugs (§9.5). A slug is an address the owner chose; renaming it 404s the old
// one on purpose (DP-W11 — no 301, because a silent redirect would make the
// promise 「地址是你的」 quietly conditional on us keeping a rename table
// forever). The console warns before it lets one change.

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function isWorkSlug(value: unknown): value is string {
	return typeof value === 'string' && SLUG_PATTERN.test(value)
}

/**
 * Title → slug. ASCII-folds what it can and drops what it cannot; a title with
 * no ASCII at all (「城市灯火」) yields '' and the caller falls back to the id
 * prefix, which is an address that at least always works.
 */
export function slugifyWorkTitle(title: string): string {
	const ascii = title
		.normalize('NFKD')
		.replace(/[\u0300-\u036F]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, WORK_LIMITS.slugMaxChars)
		.replace(/-+$/g, '')
	return SLUG_PATTERN.test(ascii) ? ascii : ''
}

/** Fallback address when a title slugifies to nothing: the id's random tail,
 * lowercased — short, collision-free in practice, and never empty. */
export function fallbackWorkSlug(workId: string): string {
	return workId.slice(-8).toLowerCase()
}

// ---------------------------------------------------------------------------
// Text sanitation — title and summary are public UGC and ride the card room,
// the OG tags and (later) the assistant's catalog, so they are stripped of
// control characters and bounded here rather than at each render site.

function dropLoneSurrogates(value: string): string {
	return value.replace(
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
		''
	)
}

export function sanitizeWorkText(raw: unknown, maxChars: number): string {
	if (typeof raw !== 'string') return ''
	return dropLoneSurrogates(
		raw
			// eslint-disable-next-line no-control-regex
			.replace(/[ -]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, maxChars)
	)
}

// ---------------------------------------------------------------------------
// 墙二 + 墙三: the sandbox token set and the two CSP profiles (§6.2/§6.3).

/**
 * The iframe `sandbox` token set, and — verbatim — the服务端 `CSP: sandbox`
 * directive's token set. Same list in both places on purpose: two lists is how
 * one of them silently becomes laxer than the other.
 *
 * ⚠️⚠️ `allow-same-origin` is NEVER here (it would undo the sandbox entirely),
 * and neither is `allow-top-navigation` (a work must never be able to carry the
 * visitor away). `allow-popups-to-escape-sandbox` rides along with
 * `allow-popups` so an external link opens as ordinary browsing rather than as
 * a crippled sandboxed page.
 */
export const WORK_SANDBOX_TOKENS = [
	'allow-scripts',
	'allow-forms',
	'allow-modals',
	'allow-pointer-lock',
	'allow-downloads',
	'allow-popups',
	'allow-popups-to-escape-sandbox'
] as const

export const WORK_SANDBOX_ATTRIBUTE = WORK_SANDBOX_TOKENS.join(' ')

/** The iframe `allow` list. camera/microphone/geolocation/payment are absent
 * deliberately — a work is a stage, not an app with a permission dialog. */
export const WORK_IFRAME_ALLOW =
	'fullscreen; autoplay; clipboard-write; gamepad; accelerometer; gyroscope'

/**
 * Named static CDNs a work may READ from (§6.3, 2026-08-03 用户裁决). Reads
 * only: they never enter connect-src, so a library arrives through a tag and
 * never through a fetch.
 *
 * This used to be one of two per-work profiles the owner picked between. It is
 * not a setting any more — every work gets this lane, because the mainstream
 * agent output (Claude artifacts and friends) links cdnjs by default and «paste
 * it and publish» must not become «first inline your dependencies». What the
 * lane does NOT touch is the exfil surface (INV-W3): connect-src, form-action
 * and frame-src read the same with it and without it. The operator fuse
 * `flags:works.cdnProfile` still pulls the whole lane in one flip.
 */
export const WORK_CDN_HOSTS = [
	'https://cdnjs.cloudflare.com',
	'https://static.cloudflareinsights.com',
	'https://cdn.jsdelivr.net',
	'https://unpkg.com',
	'https://esm.sh',
	'https://fonts.googleapis.com',
	'https://fonts.gstatic.com'
] as const

export interface WorkCspInput {
	/** Whether the named-CDN lane is open — the operator fuse, not a per-work
	 * choice: with it out, every work is served reaching nothing but its own
	 * bundle, and no work's data changes. */
	allowCdn: boolean
	/** Origin serving the bundle bytes, e.g. https://works.al.ink. */
	worksOrigin: string
	/** Origins allowed to frame the work — the app origin, plus dev origins. */
	frameAncestors: readonly string[]
}

/**
 * The full CSP for a work's HTML document. Built in one place so the exfil
 * promise (INV-W3) is one line of code rather than a convention.
 *
 * `sandbox` is included here as a DIRECTIVE — that is the §6.2 second layer:
 * a bare works.al.ink link opened in a new tab is an opaque origin too, so
 * «forward the link instead of the embed» is not a bypass.
 */
export function buildWorkCsp(input: WorkCspInput): string {
	const self = cspSource(input.worksOrigin)
	const cdn = input.allowCdn ? ` ${WORK_CDN_HOSTS.join(' ')}` : ''
	return [
		`default-src 'none'`,
		`sandbox ${WORK_SANDBOX_TOKENS.join(' ')}`,
		// 'unsafe-inline' is not a concession: a work IS its own inline script,
		// and the whole security model assumes the code inside is hostile. What
		// bounds it is where it can reach, not whether it is inline.
		`script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${self}${cdn}`,
		`style-src 'unsafe-inline' ${self}${cdn}`,
		`img-src data: blob: ${self}${cdn}`,
		`media-src data: blob: ${self}${cdn}`,
		`font-src data: ${self}${cdn}`,
		// ⚠️⚠️⚠️ The three lines that ARE the promise, and the CDN lane above
		// never reaches them (§6.3): the only connectable origin is the read-only
		// bundle source, forms submit nowhere, and nothing may be re-framed.
		`connect-src ${self}`,
		`form-action 'none'`,
		`frame-src 'none'`,
		`worker-src blob: ${self}`,
		`base-uri 'none'`,
		`frame-ancestors ${input.frameAncestors.join(' ')}`
	].join('; ')
}

/**
 * ⚠️ A CSP source whose path does NOT end in `/` matches that ONE path and
 * nothing under it. Production's origin has no path, so this never showed
 * there — but the dev stand-in serves from `<api>/works`, and without the
 * trailing slash every bundle asset (its own stylesheet, its own data file)
 * was blocked while the entry document loaded fine. A path-bearing source is
 * a prefix here or it is a trap.
 */
function cspSource(origin: string): string {
	const trimmed = origin.replace(/\/+$/, '')
	try {
		return new URL(trimmed).pathname === '/' ? trimmed : `${trimmed}/`
	} catch {
		return trimmed
	}
}

/**
 * Powerful features a work may never reach for, stated as a response header.
 *
 * ⚠️⚠️ This is the top-level half of the exclusion §6.2 already makes in the
 * `allow` attribute. On the web a work is embedded, and the iframe's `allow`
 * list — which names fullscreen/autoplay/clipboard-write/gamepad/accelerometer/
 * gyroscope and pointedly NOT camera/microphone/geolocation/payment — is the
 * whole enforcement. But works.al.ink also serves the same bytes as a TOP-LEVEL
 * document: a visitor forwards the bare bundle URL, or a mobile app renders the
 * work as its WebView's own document. There is no embedder there, so there is
 * no `allow` attribute, and every powerful feature falls back to its default
 * allowlist — which is `self`. Without this header the exclusion silently
 * stopped applying on exactly the paths where nobody is watching.
 *
 * It is the same shape of fix as `CSP: sandbox`: that one makes the bare
 * address an opaque origin instead of trusting «you must have come through an
 * iframe», and this one makes the capability denial travel with the bytes.
 *
 * ⚠️ The list is LONGER than the four §6.2 names, and deliberately so. Those
 * four were the answer to «what does the allow attribute leave out», where
 * omission IS denial. Here omission is `self`, so the header has to name
 * everything a work must never have — hardware (usb/midi/serial), the screen
 * itself (display-capture), and the headset (xr-spatial-tracking). Features the
 * work legitimately uses are absent on purpose: unlisted means default, and the
 * default for fullscreen/autoplay/gamepad/etc. is `self`, which is what the
 * embedded case grants anyway. Naming them here would change nothing and invite
 * the two lists to drift.
 *
 * ⚠️ Browsers that do not implement a feature warn about the name in the
 * console and apply the rest — an unknown item never voids the header. That
 * console line lands in the author's own devtools, which is the right place for
 * it and a price worth one denied capability.
 */
export const WORK_PERMISSIONS_POLICY = [
	'camera=()',
	'microphone=()',
	'geolocation=()',
	'payment=()',
	'display-capture=()',
	'usb=()',
	'midi=()',
	'serial=()',
	'xr-spatial-tracking=()'
].join(', ')

/**
 * Response headers every works.al.ink byte carries, whatever its type.
 *
 * ⚠️⚠️ `access-control-allow-origin: *` is not a concession — it is what makes
 * `connect-src` above mean anything. The sandbox denies `allow-same-origin`, so
 * a work's document has an OPAQUE origin (`null`): every request it makes to
 * works.al.ink — its own stylesheet, its own data file, its own entry document —
 * is a cross-origin request to the very host it was loaded from. CSP decides
 * where a work may TRY; CORS decides whether it may READ. Without this header
 * `connect-src ${self}` is a promise the transport cannot keep, and every
 * fetch/XHR inside every work fails.
 *
 * Nothing is exposed by it: these bytes answer an unauthenticated public GET
 * already, `*` carries no credentials, and a draft still needs its signed `?pv=`
 * token. What it does NOT fix by itself is a classic `<script src="./x.js">` —
 * loaded no-cors it stays a "CORS-cross-origin script" with no base URL, so its
 * dynamic `import('./y.js')` resolves against about:blank. Such a work must ask
 * for CORS mode (`crossorigin`, or `type="module"`); this header is what lets
 * that request succeed.
 */
export const WORK_BASE_HEADERS: Readonly<Record<string, string>> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'no-referrer',
	'cross-origin-resource-policy': 'cross-origin',
	'x-frame-options': 'SAMEORIGIN',
	'access-control-allow-origin': '*',
	// Range reads (a work scrubbing its own video through fetch) are unreadable
	// without these: cross-origin JS sees only the safelisted response headers.
	'access-control-expose-headers': 'content-length, content-range, accept-ranges, etag',
	'permissions-policy': WORK_PERMISSIONS_POLICY
}

// ---------------------------------------------------------------------------
// The narrow channel (§6.4, DP-W5). Kept here so both ends — the shell and the
// sdk this module's constants are copied into — name the same closed set.

/**
 * Capability closed set, v1. Five names, and the list is the design: a channel
 * that can grow without a version bump is a channel whose surface nobody knows.
 *
 * ⚠️ There is deliberately NO storage, NO network proxy, and NO visitor
 * identity. What the work receives about the viewer is three non-identifying
 * fields (signedIn / locale / theme) — PRD §17.6 物理隔离 holds inside the
 * frame exactly as it holds outside it.
 */
export const WORK_CHANNEL_CAPABILITIES = [
	'context',
	'fullscreen',
	'openDoor',
	'share',
	'themechange'
] as const
export type WorkChannelCapability = (typeof WORK_CHANNEL_CAPABILITIES)[number]

/** Handshake protocol version. An sdk that does not know this number degrades
 * to «no shell» and the work keeps working — that is the whole fallback. */
export const WORK_CHANNEL_VERSION = 1

// ---------------------------------------------------------------------------
// Views

/** One row as the owner's console sees it (every status, plus the tallies). */
export interface WorkOwnerView {
	id: string
	slug: string
	title: string
	summary: string
	coverUrl: string | null
	versionId: string
	fileCount: number
	sizeBytes: number
	status: WorkStatus
	source: WorkSource
	sortOrder: number
	viewCount: number
	createdAt: number
	updatedAt: number
	publishedAt: number | null
	blockedReason: string | null
}

/** One row as a visitor sees it. No counts — 访客面零计数 (card-v2 §14.5). */
export interface WorkPublicView {
	slug: string
	title: string
	summary: string
	coverUrl: string | null
	updatedAt: number
}

/** What the owner's console shows above the list (§5.1 用量表). Quotas are
 * stated as real numbers even when usage is over them — a downgraded account
 * reads 「已用 620 MB / 200 MB」 rather than a fiction (§8.4). */
export interface WorkUsage {
	count: number
	totalBytes: number
	maxCount: number
	maxTotalBytes: number
	maxFileBytes: number
	maxFilesPerWork: number
}
