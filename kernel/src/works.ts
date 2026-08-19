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
	/** How much of a markdown work commit reads to borrow a title and a summary
	 * from (§10.2). Bounded and best-effort: it is a courtesy, never a gate. */
	docMetaBytes: 32_768,
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
// Kinds (content-kinds doc §4). A work is still a BUNDLE of files; the kind
// only says WHO WRITES ITS ENTRY DOCUMENT — the author (`page`: the uploaded
// index.html) or the platform (every other kind: a renderer, synthesized at
// serve time, that presents the one content file sitting next to it).
//
// ⚠️⚠️ The entry ADDRESS never moves. `…/<versionId>/index.html` is what the
// room, the shell, both mobile stages and every already-shared link point at,
// whoever produces the bytes behind it. That is the whole reason the phones
// render markdown, PDFs and video without shipping a new build.
//
// ⚠️ The platform's renderer runs at the WORK's trust level, not the app's: it
// is served from the same opaque origin, under the same CSP, holding no secret
// and no visitor identity. There is no new trust boundary here, which is what
// makes a whole content type cost a renderer file instead of a security review.

export const WORK_KINDS = ['page', 'doc', 'pdf', 'video', 'audio', 'image', 'script'] as const
export type WorkKind = (typeof WORK_KINDS)[number]

/** Every kind but `page` — the ones whose entry document is synthesized. */
export type RenderedWorkKind = Exclude<WorkKind, 'page'>

export function isWorkKind(value: unknown): value is WorkKind {
	return typeof value === 'string' && (WORK_KINDS as readonly string[]).includes(value)
}

export function isRenderedWorkKind(kind: WorkKind): kind is RenderedWorkKind {
	return kind !== 'page'
}

/**
 * Extension → the kind a file of that type can be the CONTENT of.
 *
 * A subset of the whitelist above, and deliberately so: `.json`, `.glb`, `.vtt`
 * and friends are assets a work is MADE of, never the thing a visitor came to
 * see. `.html` is absent because a page is decided by its root `index.html`
 * (below) rather than by extension.
 */
const WORK_CONTENT_KIND_BY_EXT: Record<string, RenderedWorkKind> = {
	md: 'doc',
	pdf: 'pdf',
	mp4: 'video',
	webm: 'video',
	mp3: 'audio',
	wav: 'audio',
	ogg: 'audio',
	m4a: 'audio',
	png: 'image',
	jpg: 'image',
	jpeg: 'image',
	webp: 'image',
	gif: 'image',
	avif: 'image',
	svg: 'image',
	js: 'script',
	mjs: 'script'
}

/**
 * Which kind wins when a bundle holds candidates of several (§5.2).
 *
 * ⚠️ This is NOT alphabetical or arbitrary: it runs from the strongest signal
 * to the weakest. A markdown work ships images; a three.js sketch ships images
 * and models; nobody ships a document alongside a video and means the video.
 * `image` sits last because a picture is the most common ASSET in the whole
 * list, so it may only be the content when nothing else could be.
 */
const WORK_KIND_PRIORITY: readonly RenderedWorkKind[] = [
	'doc',
	'pdf',
	'video',
	'audio',
	'script',
	'image'
]

export function workContentKindForPath(path: string): RenderedWorkKind | null {
	const match = /\.([A-Za-z0-9]{1,8})$/.exec(path)
	if (!match) return null
	return WORK_CONTENT_KIND_BY_EXT[match[1].toLowerCase()] ?? null
}

/** Extensions that may be a work's content, grouped per kind — for the console's
 * file picker and for the six-language upload hint. */
export const WORK_CONTENT_EXTENSIONS: Readonly<Record<RenderedWorkKind, readonly string[]>> =
	WORK_KIND_PRIORITY.reduce(
		(acc, kind) => {
			acc[kind] = Object.entries(WORK_CONTENT_KIND_BY_EXT)
				.filter(([, value]) => value === kind)
				.map(([ext]) => ext)
			return acc
		},
		{} as Record<RenderedWorkKind, readonly string[]>
	)

export type WorkEntryResolution =
	| { ok: true; kind: WorkKind; entryPath: string }
	| { ok: false; reason: WorkEntryRefusal; message: string }

/**
 * · `no_entry` — nothing in here could be the thing a visitor opens.
 * · `ambiguous` — two files could, and guessing would silently demote one of
 *   them to an invisible asset (§5.2: this layer never guesses).
 * · `kind_mismatch` — the caller named a kind the files do not support.
 */
export type WorkEntryRefusal = 'no_entry' | 'ambiguous' | 'kind_mismatch'

/**
 * Decide what this bundle IS, from its paths alone (content-kinds doc §5.2).
 *
 * Pure, and shared by every caller that has an opinion about it: prepare (from
 * declared paths), commit (from the object keys, which are the authority), the
 * console (to tell the owner what they are about to publish before a byte
 * moves) and the MCP tools. One function, or four subtly different answers to
 * 「这是一件什么作品」.
 *
 * Order is the design:
 *   1. a root `index.html` ⇒ `page`, always, before anything else is examined.
 *      An old work can therefore never be re-interpreted into a new kind.
 *   2. an explicitly declared kind is honoured — and checked, not trusted.
 *   3. otherwise the highest-priority kind present at the ROOT wins, and it must
 *      have exactly one candidate.
 */
export function resolveWorkEntry(
	paths: readonly string[],
	declaredKind?: unknown
): WorkEntryResolution {
	const declared = declaredKind === undefined || declaredKind === null ? null : declaredKind
	if (declared !== null && !isWorkKind(declared)) {
		return {
			ok: false,
			reason: 'kind_mismatch',
			message: `Unknown work kind: ${String(declared).slice(0, 40)}`
		}
	}
	const hasIndex = paths.includes(WORK_LIMITS.entryPath)
	if (hasIndex) {
		if (declared !== null && declared !== 'page') {
			return {
				ok: false,
				reason: 'kind_mismatch',
				message: `A bundle with a root ${WORK_LIMITS.entryPath} is a web page, not a ${declared}`
			}
		}
		return { ok: true, kind: 'page', entryPath: WORK_LIMITS.entryPath }
	}
	if (declared === 'page') {
		return {
			ok: false,
			reason: 'no_entry',
			message: `A web page work needs an ${WORK_LIMITS.entryPath} at its root`
		}
	}
	// Only the root can hold the content file: a reader opens ONE thing, and a
	// rule of 「the deepest single markdown, wherever it is」 is a rule nobody
	// can hold in their head while dragging a folder in.
	const rootCandidates = paths
		.filter((path) => !path.includes('/'))
		.map((path) => ({ path, kind: workContentKindForPath(path) }))
		.filter((entry): entry is { path: string; kind: RenderedWorkKind } => entry.kind !== null)
	const kinds = declared !== null ? [declared as RenderedWorkKind] : WORK_KIND_PRIORITY
	for (const kind of kinds) {
		const matches = rootCandidates.filter((entry) => entry.kind === kind)
		if (matches.length === 1) return { ok: true, kind, entryPath: matches[0].path }
		if (matches.length > 1) {
			return {
				ok: false,
				reason: 'ambiguous',
				message: `A work holds one piece of content — this one has ${matches.length}: ${matches
					.map((entry) => entry.path)
					.join(', ')}`
			}
		}
	}
	if (declared !== null) {
		return {
			ok: false,
			reason: 'kind_mismatch',
			message: `No ${declared} file at the root of this work (looked for: ${(
				WORK_CONTENT_EXTENSIONS[declared as RenderedWorkKind] ?? []
			)
				.map((ext) => `.${ext}`)
				.join(' ')})`
		}
	}
	return {
		ok: false,
		reason: 'no_entry',
		message: `Nothing here can be opened: upload a markdown, PDF, video, audio, image or script file, or a bundle with an ${WORK_LIMITS.entryPath} at its root`
	}
}

// ---------------------------------------------------------------------------
// Entry probes (§10.2). Every one of these is a guard against a SLIP — a file
// picked by mistake, an extension that lies — and none of them is a security
// control. The sandbox is the security control. A probe that grows into a
// validator starts rejecting valid work nobody predicted, so when in doubt
// these pass.

const WORK_MAGIC_SIGNATURES: Record<string, readonly (readonly number[])[]> = {
	png: [[0x89, 0x50, 0x4e, 0x47]],
	jpg: [[0xff, 0xd8, 0xff]],
	jpeg: [[0xff, 0xd8, 0xff]],
	gif: [[0x47, 0x49, 0x46, 0x38]],
	webm: [[0x1a, 0x45, 0xdf, 0xa3]],
	ogg: [[0x4f, 0x67, 0x67, 0x53]],
	wav: [[0x52, 0x49, 0x46, 0x46]],
	webp: [[0x52, 0x49, 0x46, 0x46]],
	pdf: [[0x25, 0x50, 0x44, 0x46]]
}

/** `ftyp` at offset 4 — the MP4 family (mp4 / m4a / avif all ride it). */
const WORK_FTYP_EXTENSIONS = new Set(['mp4', 'm4a', 'avif'])
/** mp3 is either an ID3 tag or a raw frame sync; both are legal in the wild. */
const WORK_MP3_PREFIXES: readonly (readonly number[])[] = [[0x49, 0x44, 0x33]]

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
	if (bytes.length < prefix.length) return false
	return prefix.every((byte, index) => bytes[index] === byte)
}

/**
 * Decode the head of a file, or null if it is not UTF-8 text.
 *
 * ⚠️⚠️ `stream: true` is load-bearing, not a flourish. These bytes are a
 * PREFIX (512 for most kinds, 32 KB for a doc), so the cut lands mid-character
 * whenever the file is not pure ASCII — for 3-byte CJK, two times out of three.
 * A fatal decoder without it calls that an encoding error, and the probe then
 * refuses a perfectly good Chinese markdown work and deletes its upload. In
 * streaming mode an incomplete trailing sequence is simply held back, which is
 * exactly the right reading of 「there is more file after this」.
 */
function decodeUtf8(bytes: Uint8Array): string | null {
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes, {
			stream: true
		})
	} catch {
		return null
	}
}

/**
 * Look at the first bytes of the content file and say what is wrong, or null.
 *
 * `bytes` is the head of the file (`WORK_LIMITS.entryProbeBytes`), so every
 * check here is a prefix check — nothing may depend on seeing the whole file.
 */
export function probeWorkEntryBytes(
	kind: WorkKind,
	entryPath: string,
	bytes: Uint8Array
): string | null {
	const extension = /\.([A-Za-z0-9]{1,8})$/.exec(entryPath)?.[1]?.toLowerCase() ?? ''
	switch (kind) {
		case 'page': {
			const text = decodeUtf8(bytes)
			if (text === null || !text.includes('<')) {
				return `${entryPath} does not look like an HTML document`
			}
			return null
		}
		case 'doc':
		case 'script': {
			if (decodeUtf8(bytes) === null) return `${entryPath} does not look like a text file`
			return null
		}
		default: {
			if (extension === 'svg') {
				const text = decodeUtf8(bytes)
				if (text === null || !text.toLowerCase().includes('<svg')) {
					return `${entryPath} does not look like an SVG image`
				}
				return null
			}
			if (WORK_FTYP_EXTENSIONS.has(extension)) {
				// The brand box may be preceded by its own length, so `ftyp` is
				// checked at its offset rather than at the head.
				const marker = [0x66, 0x74, 0x79, 0x70]
				const ok = marker.every((byte, index) => bytes[4 + index] === byte)
				return ok ? null : `${entryPath} does not look like a ${extension.toUpperCase()} file`
			}
			if (extension === 'mp3') {
				const framed = bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
				const tagged = WORK_MP3_PREFIXES.some((prefix) => startsWith(bytes, prefix))
				return framed || tagged ? null : `${entryPath} does not look like an MP3 file`
			}
			const signatures = WORK_MAGIC_SIGNATURES[extension]
			// An extension with no signature on file passes: this list grows by
			// evidence, and an unknown shape is not evidence of a mistake.
			if (!signatures) return null
			return signatures.some((prefix) => startsWith(bytes, prefix))
				? null
				: `${entryPath} does not look like a ${extension.toUpperCase()} file`
		}
	}
}

/**
 * Borrow a title and a summary from a markdown work's own opening (§10.2).
 *
 * The first `# H1` is the title and the first prose paragraph is the summary —
 * which is what the author already wrote at the top of the file, and what the
 * OG card would otherwise have to say nothing about. Both are only ever used
 * when the caller supplied neither, so it can never overwrite an intent.
 *
 * ⚠️ Deliberately not a markdown parser: it skips front matter and fences,
 * takes the first heading and the first paragraph, and gives up on anything
 * stranger. Being wrong here costs a default nobody had before; being slow or
 * throwing here would cost the upload.
 */
export function extractDocMeta(source: string): { title: string; summary: string } {
	let text = source
	// YAML front matter: skip it whole rather than reading `---` as a rule.
	const frontMatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
	let frontTitle = ''
	if (frontMatter) {
		frontTitle = /^title:\s*["']?(.+?)["']?\s*$/m.exec(frontMatter[1])?.[1]?.trim() ?? ''
		text = text.slice(frontMatter[0].length)
	}
	const lines = text.split(/\r?\n/)
	let title = frontTitle
	let summary = ''
	let inFence = false
	for (const raw of lines) {
		const line = raw.trim()
		if (/^(```|~~~)/.test(line)) {
			inFence = !inFence
			continue
		}
		if (inFence || !line) continue
		if (!title) {
			const heading = /^#\s+(.+)$/.exec(line)
			if (heading) {
				title = heading[1].trim()
				continue
			}
		}
		// A second heading, a list, a table, a quote or an image is structure, not
		// a summary — the paragraph being looked for is prose.
		if (/^(#|[-*+>|]|\d+\.|!\[|<)/.test(line)) continue
		summary = line
		break
	}
	return {
		title: stripInlineMarkdown(title),
		summary: stripInlineMarkdown(summary)
	}
}

/** Drop the marks that would read as noise in a room grid or an OG card. */
function stripInlineMarkdown(value: string): string {
	return value
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`~]+/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

/** Fallback title for a rendered work: the content file's own name, which is
 * what its author called it. (A page falls back to `index`, as it always has —
 * it has no other name to offer.) */
export function workTitleFromEntryPath(entryPath: string): string {
	const base = entryPath.split('/').pop() ?? entryPath
	return base.replace(/\.[A-Za-z0-9]{1,8}$/, '') || base
}

// ---------------------------------------------------------------------------
// Renderers (§7, §8). The runtime lives in R2 under a RESERVED prefix that no
// user object can ever collide with (`parseWorkObjectKey` only recognises keys
// starting `works/`), and the worker serves it under `/-/r/` with an immutable
// cache — a renderer changes by changing its address, never in place.

/** Reserved bucket prefix for platform-authored renderer assets. */
export const WORK_RENDERER_PREFIX = 'platform/renderers/'

/**
 * Contract version of the entry document: the shape of the JSON block below.
 * Bumping it is a migration (old rows keep their own `render_major`), which is
 * exactly why the renderers may be fixed freely inside one major.
 */
export const WORK_RENDERER_MAJOR = 1

/**
 * Code version, per renderer. Bump the one you changed; the entry document
 * points at the new address within the HTML cache window (5 min) and every
 * work is on the new code without anyone republishing anything.
 *
 * ⚠️⚠️ 恒序: publish the assets to R2 FIRST, deploy the worker that names them
 * SECOND. The other order is an entry document pointing at an object that does
 * not exist yet — a blank stage for every work of that kind.
 */
export const WORK_RENDERER_BUILDS: Readonly<Record<string, Readonly<Record<number, string>>>> = {
	doc: { 1: '20260818a' },
	pdf: { 1: '20260818a' },
	media: { 1: '20260818a' },
	image: { 1: '20260818a' },
	script: { 1: '20260818a' }
}

/** video and audio are one renderer with two faces — the controls, the poster
 * and the keyboard map are the same thing; only the picture differs. */
const WORK_RENDERER_BY_KIND: Readonly<Record<RenderedWorkKind, string>> = {
	doc: 'doc',
	pdf: 'pdf',
	video: 'media',
	audio: 'media',
	image: 'image',
	script: 'script'
}

export function workRendererName(kind: RenderedWorkKind): string {
	return WORK_RENDERER_BY_KIND[kind]
}

/**
 * `<major>.<build>` — one directory per shipped renderer version, forever.
 *
 * ⚠️⚠️ The build map is keyed by renderer AND major. It has one major in it
 * today, and the shape is what keeps the promise on the row: a work publishes
 * against a major and is served that major's build for the rest of its life.
 * Keying builds by renderer alone would have addressed an old work as
 * `1.<newest-build>` the day a v2 shipped — an object that does not exist, or
 * worse, v2 code sitting at a v1 address. Whoever ships v2 adds a `2:` entry
 * beside the `1:`; nothing else has to move.
 */
export function workRendererVersion(renderer: string, major = WORK_RENDERER_MAJOR): string {
	const build = WORK_RENDERER_BUILDS[renderer]?.[major]
	return build ? `${major}.${build}` : ''
}

/** URL path prefix a renderer's own assets (chunks, wasm, fonts) resolve
 * against. Absolute on purpose: the renderer is NOT part of the work, so it
 * must not inherit the preview token prefix a relative URL would pick up. */
export function workRendererBasePath(renderer: string, major = WORK_RENDERER_MAJOR): string {
	// A row naming a major nobody ships any more (a rollback, a hand-edited
	// row) falls back to the current one: serving the newest renderer is a
	// cosmetic risk, while addressing a directory that was never published is a
	// blank stage.
	const version = workRendererVersion(renderer, major) || workRendererVersion(renderer)
	return `/-/r/${renderer}/${version}/`
}

/** R2 key for one renderer file. Mirrors the URL path 1:1 so a mis-serve is
 * visible by reading either side. */
export function workRendererObjectKey(
	renderer: string,
	version: string,
	file: string
): string | null {
	if (!/^[a-z][a-z0-9-]{0,30}$/.test(renderer)) return null
	if (!/^[0-9]{1,3}\.[0-9a-z]{1,32}$/.test(version)) return null
	const path = normalizeWorkPath(file)
	if (!path) return null
	return `${WORK_RENDERER_PREFIX}${renderer}/${version}/${path}`
}

// ---------------------------------------------------------------------------
// Render options (`render_json`, §9.1)

/** Per-kind facts about the REST of the bundle that a renderer cannot see.
 * Bounded, JSON-safe, and derived by the server — never author-supplied. */
export interface WorkRenderOptions {
	/** Caption/subtitle tracks beside a video or audio file. */
	tracks?: string[]
	/** A poster image for a media work. */
	poster?: string
}

/**
 * What else in this bundle the renderer needs to know about (§7.3).
 *
 * ⚠️ The alternative was for the media renderer to GUESS — HEAD `film.vtt`,
 * then `captions.vtt`, and add a track if either answers. That works, and it
 * puts two 404s in the console of every video work that has no captions, plus
 * a rule every uploader has to learn. The server already holds the manifest at
 * commit; telling the renderer the truth costs one column that was already
 * there.
 */
export function buildWorkRenderOptions(
	kind: WorkKind,
	paths: readonly string[]
): WorkRenderOptions {
	if (kind !== 'video' && kind !== 'audio') return {}
	const options: WorkRenderOptions = {}
	const tracks = paths.filter((path) => path.toLowerCase().endsWith('.vtt')).slice(0, 8)
	if (tracks.length > 0) options.tracks = tracks
	// A poster is named `poster.*` at the root, and nothing else is: guessing
	// among a bundle's images would mean a work whose poster changes when the
	// author adds a picture.
	const poster = paths.find((path) => /^poster\.(png|jpg|jpeg|webp|avif|gif)$/i.test(path))
	if (poster) options.poster = poster
	return options
}

// ---------------------------------------------------------------------------
// The synthesized entry document (§7.3)

export interface WorkEntryDocumentInput {
	kind: RenderedWorkKind
	/** Path of the content file inside the bundle, e.g. `paper.md`. */
	entryPath: string
	title: string
	/** Renderer contract major this work was published against. */
	renderMajor?: number
	/** Per-kind options (`render_json`), server-derived (§7.3). */
	options?: Readonly<Record<string, unknown>>
	/** BCP-47 tag for the document element, best effort. */
	locale?: string
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/**
 * Build the entry document for a rendered work.
 *
 * ⚠️⚠️ Owner-controlled text (the title) reaches the renderer through a
 * `application/json` block and NEVER through a JS literal or an HTML attribute.
 * Inside the sandbox an injection here would escalate to nothing at all — the
 * document is already opaque-origin and already assumed hostile — but a
 * renderer with its own XSS is a renderer nobody can reason about, and the `<`
 * escaping below costs one line.
 *
 * ⚠️ The content file is referenced RELATIVELY (`./paper.md`) so the published
 * path and the signed preview prefix both resolve without a second code path:
 * 预览即所得 falls out of addressing instead of being maintained.
 *
 * ⚠️ The renderer's own files are ABSOLUTE (`/-/r/…`) for the mirror-image
 * reason: a renderer is not part of the work, so it must not inherit a preview
 * token prefix, and its address must not change when the work's does.
 *
 * The sdk (works §7) is loaded for the renderer's benefit — theme, locale,
 * fullscreen — which makes the platform's own viewer the first consumer of the
 * public channel rather than of a private one. If a renderer ever needs
 * something the sdk cannot do, that is the sdk missing a capability for
 * everybody, not a reason for a back door.
 */
export function buildWorkEntryDocument(input: WorkEntryDocumentInput): string {
	const renderer = workRendererName(input.kind)
	const major = input.renderMajor ?? WORK_RENDERER_MAJOR
	const base = workRendererBasePath(renderer, major)
	const payload = JSON.stringify({
		// ⚠️ The MAJOR THIS WORK WAS PUBLISHED AGAINST, not the newest one: the
		// contract a renderer reads must be the contract of the renderer being
		// addressed one line above, or a v1 work would be handed a v2 payload.
		v: major,
		kind: input.kind,
		src: `./${input.entryPath}`,
		title: input.title,
		options: input.options ?? {}
	}).replace(/</g, '\\u003c')
	const lang = /^[A-Za-z][A-Za-z0-9-]{1,34}$/.test(input.locale ?? '') ? input.locale : 'en'
	return `<!doctype html>
<html lang="${escapeHtml(lang!)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(input.title)}</title>
<link rel="stylesheet" href="${base}index.css">
<script type="application/json" id="alink-work">${payload}</script>
</head>
<body>
<script src="/-/sdk/v1.js"></script>
<script type="module" src="${base}index.js"></script>
</body>
</html>
`
}

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
	/** page | doc | pdf | video | audio | image | script (content-kinds §4). */
	kind: WorkKind
	/** The file the entry presents; `index.html` for a page. */
	entryPath: string
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
	/** What opening it will show — an icon in the grid, never a new noun. */
	kind: WorkKind
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
