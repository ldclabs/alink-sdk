import type { HandleClass, IdPrefix } from './types.js'

export const ID_PREFIXES = [
	'agt',
	'hcard',
	'acard',
	'contact',
	'rel',
	'relctx',
	'relperm',
	'consent',
	'del',
	'handle',
	'sub',
	'usage',
	'guest',
	'intent',
	'match',
	'req',
	'msg',
	'appr',
	'audit',
	'evt',
	'trace',
	'contract',
	'intake',
	'thread',
	'tmsg',
	'adel',
	'seat',
	'oac',
	'ogr',
	'ref',
	'emch',
	'sq',
	'csn',
	'cmsg',
	'brf',
	'cvm',
	'offer',
	'bkg',
	'avw',
	'avx',
	'mat',
	// Grove (docs/alink-grove-devplan.md WP-G1): grove/tree/seed/fruit, care
	// events, story entries, guest plant requests, and one-line notes.
	'grove',
	'tree',
	'seed',
	'fruit',
	'care',
	'gsty',
	'gpr',
	'gmsg',
	// Sprite (docs/alink-sprite-devplan.md WP-S2): the body's own stable id,
	// minted once at birth. Experience ids are deterministic (`sxp_<type>`) and
	// deliberately do NOT go through makeId — one row per milestone, forever.
	'spr',
	// Organization × Collaboration (docs/alink-collaboration-devplan.md WP-K1).
	// The organization principal is NOT here — `org_<xid>` is a minted identity
	// (organizationIdFromXid below), the same shape as `conn_<xid>`.
	'mbr',
	'orl',
	'ocg',
	'odel',
	'oap',
	'oapr',
	'oaz',
	'olg',
	'clb',
	'cseat',
	'cpt',
	'dec',
	'cmt',
	'dlv',
	'ocm',
	'cap',
	'clg',
	'inv',
	// Works (docs/alink-works.md WP-W1). Minted at prepare time, because the
	// presigned keys are built around it before a single byte has moved.
	'work',
	// One report against a work (§6.6). Lives in the operator queue only.
	'wrpt',
	// Settlement (docs/alink-settlement.md §3): owner payment method, the card
	// snapshot issued into a thread, and a report against a card.
	'smth',
	'scrd',
	'srpt'
] as const satisfies readonly IdPrefix[]

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ID_PATTERN = /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/
const XID_PATTERN = /^[0-9a-v]{20}$/
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,17}[a-z0-9])?$/
const HANDLE_DISPLAY_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,17}[a-zA-Z0-9])?$/

/**
 * Static reserved-handle seed list (commercialization doc §3.3): system
 * routes and protocol words that must never resolve as user handles. This is
 * the first barrier; the handles table additionally carries reserved /
 * protected rows (brand and personal-name protection) as the second.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
	// System routes and protocol words.
	'admin',
	'al',
	'alink',
	'api',
	'app',
	'apps',
	'assets',
	'auth',
	'billing',
	'blog',
	'bootstrap',
	'claim',
	'contract',
	// Public visitor-conversation route (/converse/:slug, §5.1) — the prefix
	// must never shadow a user alias on the principal catch-all.
	'converse',
	// Permanent demo card: al.ink/demo is a fixed product surface (the app
	// renders the built-in demo profile there), never a claimable name.
	'demo',
	// GROVE_DEPARTED_USER (grove §27.4): the sentinel grove reads serve in place
	// of a deleted user's xid. It is deliberately not a valid xid, but it IS a
	// valid HANDLE shape — so without this row someone could claim al.ink/departed
	// and every 「一位已离开的用户」 the API hands out would become a resolvable
	// slug pointing at them. Reserving it makes the sentinel's promise structural
	// instead of resting on each render site remembering to special-case it.
	'departed',
	'dev',
	'developers',
	'docs',
	'event',
	'events',
	'export',
	'handle',
	'handles',
	'healthz',
	'help',
	// Official contact mailbox localpart (hi@al.ink) — never a claimable name.
	'hi',
	'inbox',
	'ink',
	'intake',
	'join',
	'legal',
	'login',
	'mail',
	'mcp',
	'me',
	'media',
	// Locker download route (/locker/:token, material-locker doc §4) — same
	// route-shadow rule as 'media'.
	'locker',
	'oauth',
	// Dynamic OG card route (/og/<xid>.png, entry plan A2) — route prefix.
	'og',
	// 广场 (evidence-plan §5.3): the public timeline lives at /plaza on the API
	// and /-/plaza in the app — reserved on the same route-shadow rule as
	// 'converse', so no user alias can ever take the name.
	'plaza',
	'privacy',
	'profile',
	'register',
	'root',
	'security',
	'settings',
	// Public encounter beacon route (/signals/:slug, §8.3) — same shadow rule
	// as 'converse'.
	'signals',
	'signin',
	'signup',
	// Sprite body route (/sprite/:ownerXid/body/:hash.svg, sprite devplan TD-S7)
	// — the same route-shadow rule as 'media' and 'locker'. A sprite has no page
	// of its own by design (§3.6), so this prefix only ever serves bytes.
	'sprite',
	'static',
	'status',
	'support',
	'system',
	'terms',
	// /intake/thread/:token (§6.10) would shadow /intake/<slug>/card for a
	// user named 'thread' — the segment can never be a claimable name.
	'thread',
	'threads',
	// Trust/isolation explainer page (al.ink/trust, §13.6) — app route shadow.
	'trust',
	'unsubscribe',
	'v1',
	'v2',
	'webhooks',
	'well-known',
	'whitepaper',
	// 作品 (works doc §6.1): the dev/legacy `/works/*` fallback prefix, and
	// `/w/*` on the bundle host. Reserved on the same reasoning as 'media' —
	// a prefix that can shadow a user alias on the principal catch-all is a
	// name somebody will eventually claim.
	'works',
	'w',
	'www',
	'xid',
	// High-value generic words frozen for the auction/reserved policy (§3.3).
	'ai',
	'vc',
	'ceo',
	'cto',
	'cfo',
	'gp',
	'lp',
	'fund',
	'team',
	'org',
	// Organization card read prefix (GET /orgs/:slug/card) and the app route
	// that mirrors it — the same route-shadow rule as 'media' and 'locker'.
	'orgs',
	'company',
	// RFC 2142 role addresses + mail-infrastructure words (email-alias doc
	// E1-c): once `<handle>@mail.al.ink` resolves, a user holding one of these
	// names would receive the domain's role mail (abuse reports, DSNs).
	'postmaster',
	'abuse',
	'hostmaster',
	'webmaster',
	'noc',
	'mailer-daemon',
	'noreply',
	'no-reply',
	'bounce',
	'bounces',
	'dmarc',
	'dkim',
	'spf'
])

export function isValidXid(value: string): boolean {
	return XID_PATTERN.test(value)
}

/**
 * When the account behind an xid was created, in unix ms — read out of the id
 * itself (an xid's first 4 bytes are its mint second).
 *
 * The point is that an account's age needs no storage read: any surface that
 * already knows a userId already knows how old it is. Sprite's 新账号首日 cap
 * (devplan §7) is the first caller, and it runs on the hot wake path where an
 * extra DO round trip per move would have been the reason not to have the rule.
 *
 * Precision is one second, and the value is only as trustworthy as the minting
 * side — which here is HandleRegistryDO, i.e. ours. Never use it as an
 * authorization fact; use it for pacing, the way it is used below.
 */
export function xidCreatedAt(value: string): number | null {
	if (!isValidXid(value)) return null
	// An xid string is its 12 bytes packed MSB-first into 5-bit base32hex
	// characters, so the first 8 characters are the first 40 bits: the 4-byte
	// timestamp followed by the first byte of the machine id. Decode those 40
	// bits and drop the 8 that are not the clock.
	let bits = 0
	for (let i = 0; i < 8; i += 1) {
		const code = value.charCodeAt(i)
		// '0'-'9' → 0-9, 'a'-'v' → 10-31 (the alphabet XID_PATTERN allows).
		bits = bits * 32 + (code <= 57 ? code - 48 : code - 87)
	}
	return Math.floor(bits / 256) * 1000
}

// Connection ids (product doc §6.6) are `conn_<xid>` — the xid comes from the
// HandleRegistryDO generator (never a bare `new Xid()`), so they deliberately
// do NOT follow the makeId prefix format and are validated separately.
const CONNECTION_ID_PATTERN = /^conn_[0-9a-v]{20}$/

export function connectionIdFromXid(xid: string): string {
	if (!isValidXid(xid)) {
		throw new Error(`Invalid xid for connection id: ${xid}`)
	}
	return `conn_${xid}`
}

export function isValidConnectionId(value: string): boolean {
	return CONNECTION_ID_PATTERN.test(value)
}

/**
 * Organization principal ids (collaboration doc §2.3) — `org_<xid>`, minted the
 * same way a person's identity is (HandleRegistryDO; never a bare `new Xid()`).
 *
 * The prefix is load-bearing rather than decorative. An organization is a
 * Principal and therefore shares one public namespace with people: the same
 * `/:slug` catch-all, the same handle registry, the same alias cache. Carrying
 * the kind IN the id means every one of those surfaces can tell an organization
 * from a person without a lookup — most importantly `idx:handle`, whose value
 * is the target id, so `al.ink/studiox` resolves to something self-describing
 * instead of needing a parallel type column that could drift.
 *
 * The canonical URL is still the id URL (PRD §12.8): `al.ink/org_<xid>`, with
 * the handle a reclaimable 307 alias in front of it.
 */
const ORGANIZATION_ID_PATTERN = /^org_[0-9a-v]{20}$/

export function organizationIdFromXid(xid: string): string {
	if (!isValidXid(xid)) {
		throw new Error(`Invalid xid for organization id: ${xid}`)
	}
	return `org_${xid}`
}

export function isValidOrganizationId(value: string): boolean {
	return ORGANIZATION_ID_PATTERN.test(value)
}

/**
 * The bare xid inside an organization id. Only for surfaces whose key space is
 * already type-segmented and therefore must not repeat the prefix — the OG
 * route (`/og/org/<xid>.png`) and R2 media keys. Never for identity: an
 * organization's identity is the prefixed id, and a bare xid handed to a
 * principal lookup would be a person's id space.
 */
export function organizationXidOf(organizationId: string): string {
	if (!isValidOrganizationId(organizationId)) {
		throw new Error(`Invalid organization id: ${organizationId}`)
	}
	return organizationId.slice('org_'.length)
}

export function isValidHandle(value: string): boolean {
	return HANDLE_PATTERN.test(value)
}

/**
 * A user-typed handle with letter casing free ("Yan"). Casing is DISPLAY-ONLY:
 * uniqueness and resolution always run on the canonical lowercase form, so a
 * valid display handle lowercases to a valid canonical handle by construction.
 */
export function isValidDisplayHandle(value: string): boolean {
	return HANDLE_DISPLAY_PATTERN.test(value)
}

/**
 * Canonicalize a typed handle (or a public /:slug segment) for uniqueness
 * checks and resolution: al.ink/Yan and al.ink/yan are the same name. The
 * typed casing travels separately as the display handle.
 */
export function normalizeHandle(value: string): string {
	return value.trim().toLowerCase()
}

export function isReservedHandle(value: string): boolean {
	return RESERVED_HANDLES.has(value)
}

// Segmentation per commercialization doc §2.1: standard 7-19 (Plus),
// compact 5-6 (Pro), short 3-4 (Max), premium 1-2 (invite/auction).
export function handleClassOf(handle: string): Exclude<HandleClass, 'xid'> {
	if (!isValidHandle(handle)) {
		throw new Error(`Invalid handle: ${handle}`)
	}
	if (handle.length >= 7) return 'standard'
	if (handle.length >= 5) return 'compact'
	if (handle.length >= 3) return 'short'
	return 'premium'
}

export function makeId(prefix: IdPrefix, now: Date = new Date()): string {
	assertKnownPrefix(prefix)

	const random = new Uint8Array(10)
	getCrypto().getRandomValues(random)

	return `${prefix}_${encodeTime(now.getTime())}${encodeRandom(random)}`
}

export function makeTraceId(now: Date = new Date()): string {
	return makeId('trace', now)
}

export function isValidPrefixedId(value: string, expectedPrefix?: IdPrefix): boolean {
	if (!ID_PATTERN.test(value)) return false
	if (!expectedPrefix) return true
	return value.startsWith(`${expectedPrefix}_`)
}

export function parsePrefixedId(value: string): { prefix: IdPrefix; value: string } {
	if (!isValidPrefixedId(value)) {
		throw new Error(`Invalid prefixed id: ${value}`)
	}

	const separator = value.indexOf('_')
	const prefix = value.slice(0, separator) as IdPrefix
	assertKnownPrefix(prefix)

	return {
		prefix,
		value: value.slice(separator + 1)
	}
}

function assertKnownPrefix(prefix: IdPrefix): void {
	if (!(ID_PREFIXES as readonly string[]).includes(prefix)) {
		throw new Error(`Unknown id prefix: ${prefix}`)
	}
}

function encodeTime(timestampMs: number): string {
	if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
		throw new Error(`Invalid timestamp for id generation: ${timestampMs}`)
	}

	let value = timestampMs
	const output = new Array<string>(10)
	for (let index = 9; index >= 0; index -= 1) {
		output[index] = CROCKFORD[value % 32] ?? '0'
		value = Math.floor(value / 32)
	}

	return output.join('')
}

function encodeRandom(bytes: Uint8Array): string {
	let bits = 0
	let bitLength = 0
	let output = ''

	for (const byte of bytes) {
		bits = (bits << 8) | byte
		bitLength += 8

		while (bitLength >= 5) {
			const index = (bits >>> (bitLength - 5)) & 31
			output += CROCKFORD[index] ?? '0'
			bitLength -= 5
		}
	}

	if (bitLength > 0) {
		output += CROCKFORD[(bits << (5 - bitLength)) & 31] ?? '0'
	}

	return output.slice(0, 16)
}

function getCrypto(): Crypto {
	const cryptoApi = crypto
	if (!cryptoApi?.getRandomValues) {
		throw new Error('crypto.getRandomValues is required')
	}

	return cryptoApi
}
