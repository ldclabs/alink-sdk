import { AlinkCoreError } from './errors.js'

// ---------------------------------------------------------------------------
// 身体消毒器 (docs/alink-sprite.md §4.2, devplan TD-S7).
//
// A sprite body is a piece of SVG written by somebody else's AI and rendered
// inside other people's groves. This file is the first of the two walls that
// make that safe; the second is that the result is only ever rendered in an
// IMAGE context (`<img src=…>`), where no script can run at all.
//
// The parser is deliberately hand-written and deliberately strict. It is not a
// browser: it does not recover from malformed input, it does not guess, and it
// rejects anything it does not positively recognise. Every rule below either
// closes an attack surface or enforces a product invariant — none of them are
// stylistic.
//
// Product rules enforced here (§4.2 三条画师须知 + 静止即成立):
//   · no <text>       — an image context has no site fonts, and letters drawn
//                       into a body are a free-text channel around triage;
//   · CSS only, no SMIL — CSS animation can be switched off wholesale by the
//                       reduced-motion rule this file injects; SMIL cannot;
//   · 静止即成立      — anything invisible at rest is rejected, because the
//                       share card and every rasteriser only ever see frame 0.
//
// Nothing here reads the clock, the network or storage: sanitising the same
// bytes twice always produces the same bytes.

// ---------------------------------------------------------------------------
// Limits

/**
 * Post-normalisation byte budget for one body.
 *
 * Sized so the node cap is actually reachable: the WP-S0 «满上限» sample lands
 * at ~1500 nodes / ~68 KB, i.e. roughly 45 bytes per node. A 64 KB ceiling would
 * make `SPRITE_BODY_MAX_NODES` unreachable in practice, so the two caps are
 * matched with headroom instead of contradicting each other. Weight is cheap
 * here because a body is served as its own immutable, content-addressed
 * resource (TD-S7) — it never rides inside a grove's JSON payload.
 */
export const SPRITE_BODY_MAX_BYTES = 96 * 1024
/** Pre-parse guard so a hostile 10 MB string never reaches the tokenizer. */
export const SPRITE_BODY_MAX_INPUT_BYTES = 256 * 1024
export const SPRITE_BODY_MAX_NODES = 1500
export const SPRITE_BODY_MAX_DEPTH = 32
export const SPRITE_BODY_MAX_ATTRS_PER_NODE = 32
export const SPRITE_BODY_MAX_STYLE_BYTES = 8 * 1024
export const SPRITE_BODY_MAX_KEYFRAMES = 40
/** Coordinates beyond this are geometry nobody meant to draw. */
const MAX_ABS_NUMBER = 1e6

// ---------------------------------------------------------------------------
// Whitelists
//
// Kept intentionally short. `use`, `filter`, `mask`, `pattern`, `symbol`,
// `image`, `foreignObject`, `title` and `desc` are all absent on purpose:
//   · use / symbol      — self-referencing graphs are an expansion bomb;
//   · filter            — a large blur over a large area is a cheap GPU DoS;
//   · mask / pattern    — more id plumbing than v1 needs; can be opened later;
//   · image             — an external reference by definition;
//   · foreignObject     — arbitrary HTML, i.e. the whole point of the wall;
//   · title / desc      — accessibility lives on the form card's altText.

const ELEMENTS = new Set([
	'svg',
	'g',
	'defs',
	'style',
	'clipPath',
	'linearGradient',
	'radialGradient',
	'stop',
	'path',
	'rect',
	'circle',
	'ellipse',
	'line',
	'polyline',
	'polygon'
])

/** Elements that may not contain other elements. */
const LEAF_ELEMENTS = new Set([
	'style',
	'stop',
	'path',
	'rect',
	'circle',
	'ellipse',
	'line',
	'polyline',
	'polygon'
])

/** Allowed on any element. */
const GLOBAL_ATTRS = new Set([
	'id',
	'class',
	'transform',
	'style',
	'opacity',
	'fill',
	'fill-opacity',
	'fill-rule',
	'clip-path',
	'clip-rule',
	'stroke',
	'stroke-width',
	'stroke-opacity',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-miterlimit',
	'stroke-dasharray',
	'stroke-dashoffset',
	'paint-order',
	'shape-rendering',
	'vector-effect'
])

const ELEMENT_ATTRS: Record<string, readonly string[]> = {
	svg: ['viewBox', 'preserveAspectRatio'],
	rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
	circle: ['cx', 'cy', 'r'],
	ellipse: ['cx', 'cy', 'rx', 'ry'],
	line: ['x1', 'y1', 'x2', 'y2'],
	path: ['d', 'pathLength'],
	polyline: ['points'],
	polygon: ['points'],
	linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
	radialGradient: [
		'cx',
		'cy',
		'r',
		'fx',
		'fy',
		'gradientUnits',
		'gradientTransform',
		'spreadMethod'
	],
	stop: ['offset', 'stop-color', 'stop-opacity'],
	clipPath: ['clipPathUnits']
}

/** Attributes whose value is a paint (colour, `none`, or a gradient ref). */
const PAINT_ATTRS = new Set(['fill', 'stroke', 'stop-color'])
/** Attributes whose value must be a plain number (or list of numbers). */
const NUMERIC_ATTRS = new Set([
	'opacity',
	'fill-opacity',
	'stroke-opacity',
	'stroke-width',
	'stroke-miterlimit',
	'stroke-dashoffset',
	'pathLength',
	'x',
	'y',
	'width',
	'height',
	'rx',
	'ry',
	'cx',
	'cy',
	'r',
	'fx',
	'fy',
	'x1',
	'y1',
	'x2',
	'y2',
	'offset',
	'stop-opacity'
])

const ENUM_ATTRS: Record<string, readonly string[]> = {
	'fill-rule': ['nonzero', 'evenodd'],
	'clip-rule': ['nonzero', 'evenodd'],
	'stroke-linecap': ['butt', 'round', 'square'],
	'stroke-linejoin': ['miter', 'round', 'bevel', 'arcs', 'miter-clip'],
	'paint-order': ['normal', 'fill', 'stroke', 'markers', 'fill stroke', 'stroke fill'],
	'shape-rendering': ['auto', 'optimizeSpeed', 'crispEdges', 'geometricPrecision'],
	'vector-effect': ['none', 'non-scaling-stroke'],
	gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'],
	clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'],
	spreadMethod: ['pad', 'reflect', 'repeat']
}

/** CSS declarations allowed inside `<style>` and inline `style=""`. Drawing
 * and animation only: no layout, no text, no filters, no blending. */
const CSS_PROPERTIES = new Set([
	'fill',
	'fill-opacity',
	'fill-rule',
	'stroke',
	'stroke-width',
	'stroke-opacity',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-dasharray',
	'stroke-dashoffset',
	'opacity',
	'transform',
	'transform-origin',
	'transform-box',
	'animation',
	'animation-name',
	'animation-duration',
	'animation-timing-function',
	'animation-delay',
	'animation-iteration-count',
	'animation-direction',
	'animation-fill-mode',
	'animation-play-state',
	'r',
	'rx',
	'ry',
	'cx',
	'cy',
	'x',
	'y',
	'width',
	'height',
	'd',
	'offset-distance'
])

const TRANSFORM_FUNCTIONS = new Set([
	'matrix',
	'translate',
	'translateX',
	'translateY',
	'scale',
	'scaleX',
	'scaleY',
	'rotate',
	'skewX',
	'skewY'
])

/** Predefined XML entities. Numeric character references are rejected outright
 * — they exist in hostile input only to smuggle a keyword past a filter. */
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'"
}

// ---------------------------------------------------------------------------

export interface SanitizedSpriteBody {
	/** Canonical, re-serialised SVG. This is what gets stored and served. */
	svg: string
	nodeCount: number
	byteLength: number
	/** Intrinsic size taken from the viewBox — the served root always carries
	 * explicit pixel width/height (the WP-G7 satori lesson). */
	viewBox: readonly [number, number, number, number]
	/** True when the body carries at least one CSS animation. */
	animated: boolean
}

function reject(detail: string): never {
	throw new AlinkCoreError('SPRITE_BODY_INVALID', detail)
}

interface Attr {
	name: string
	value: string
}

interface ElementNode {
	name: string
	attrs: Attr[]
	children: ElementNode[]
	/** Raw text, `style` only. */
	text?: string
}

// ---------------------------------------------------------------------------
// Tokenizer

const NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/
/** Namespaced names are tokenized rather than refused, so the walk can DROP the
 * author's `xmlns:*` copies (the server emits the namespace itself) and refuse
 * `xlink:*` with the reason it is refused. Rejecting them here instead would
 * bounce the boilerplate almost every SVG generator emits. */
const ATTR_NAME_RE = /^[A-Za-z][A-Za-z0-9-]*(?::[A-Za-z][A-Za-z0-9-]*)?$/
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const CLASS_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

function decodeEntities(raw: string, where: string): string {
	let out = ''
	let i = 0
	while (i < raw.length) {
		const ch = raw[i]
		if (ch !== '&') {
			out += ch
			i += 1
			continue
		}
		const end = raw.indexOf(';', i)
		if (end < 0 || end - i > 6)
			reject(`Unrecognised "&" in ${where}: write &amp; if you mean an ampersand.`)
		const name = raw.slice(i + 1, end)
		const replacement = NAMED_ENTITIES[name]
		if (replacement === undefined) {
			reject(`Only &amp; &lt; &gt; &quot; &apos; are allowed (found "&${name};" in ${where}).`)
		}
		out += replacement
		i = end + 1
	}
	return out
}

function encodeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function encodeAttr(value: string): string {
	return encodeText(value).replace(/"/g, '&quot;')
}

/**
 * `<style>` content is XML text, so a bare `&` (which an author can reach by
 * writing `&amp;` in a declaration value) makes the whole document unparseable
 * the moment it is served as `image/svg+xml`. `>` is legal in XML text and is
 * left alone, so descendant selectors survive verbatim.
 *
 * Escaping rather than rejecting also keeps sanitising idempotent: the next
 * pass decodes `&amp;` back to `&` and re-escapes it to the same bytes.
 */
function encodeStyleText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

function parse(source: string): ElementNode {
	let i = 0
	const stack: ElementNode[] = []
	let root: ElementNode | null = null
	let nodeCount = 0

	const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r'
	const skipSpace = (): void => {
		while (i < source.length && isSpace(source[i]!)) i += 1
	}

	while (i < source.length) {
		if (source[i] !== '<') {
			// Text node. Only whitespace is allowed outside <style>: with <text>
			// banned, stray characters cannot render, and silently dropping them
			// would hide the author's mistake.
			const next = source.indexOf('<', i)
			const chunk = source.slice(i, next < 0 ? source.length : next)
			const parent = stack[stack.length - 1]
			if (parent && parent.name === 'style') {
				parent.text = (parent.text ?? '') + chunk
			} else if (chunk.trim().length > 0) {
				reject('A body carries shapes, not loose text — put words on the form card instead.')
			}
			i = next < 0 ? source.length : next
			continue
		}

		if (source.startsWith('<!--', i)) {
			const end = source.indexOf('-->', i + 4)
			if (end < 0) reject('Unterminated comment.')
			i = end + 3
			continue
		}
		if (
			source.startsWith('<!DOCTYPE', i) ||
			source.startsWith('<!ENTITY', i) ||
			source.startsWith('<![', i)
		) {
			reject('Doctypes, entity declarations and CDATA are not allowed in a body.')
		}
		if (source.startsWith('<?', i)) {
			const end = source.indexOf('?>', i + 2)
			if (end < 0) reject('Unterminated processing instruction.')
			if (!source.startsWith('<?xml', i))
				reject('Processing instructions are not allowed in a body.')
			i = end + 2
			continue
		}

		// Closing tag
		if (source.startsWith('</', i)) {
			const end = source.indexOf('>', i + 2)
			if (end < 0) reject('Unterminated closing tag.')
			const name = source.slice(i + 2, end).trim()
			const open = stack.pop()
			if (!open || open.name !== name) {
				reject(`Mismatched closing tag </${name}>.`)
			}
			i = end + 1
			continue
		}

		// Opening tag
		i += 1
		const nameStart = i
		while (i < source.length && !isSpace(source[i]!) && source[i] !== '>' && source[i] !== '/')
			i += 1
		const name = source.slice(nameStart, i)
		if (!NAME_RE.test(name)) reject(`Not a valid element name: <${name}>.`)

		const attrs: Attr[] = []
		let selfClosing = false
		for (;;) {
			skipSpace()
			if (i >= source.length) reject(`Unterminated <${name}>.`)
			if (source[i] === '>') {
				i += 1
				break
			}
			if (source[i] === '/') {
				if (source[i + 1] !== '>') reject(`Unterminated <${name}>.`)
				selfClosing = true
				i += 2
				break
			}
			const attrStart = i
			while (i < source.length && source[i] !== '=' && !isSpace(source[i]!) && source[i] !== '>')
				i += 1
			const attrName = source.slice(attrStart, i)
			if (!ATTR_NAME_RE.test(attrName))
				reject(`Not a valid attribute name on <${name}>: "${attrName}".`)
			// XML forbids a repeated attribute name, and re-serialising both would
			// hand back a document no renderer will parse.
			if (attrs.some((existing) => existing.name === attrName)) {
				reject(`<${name}> repeats the attribute "${attrName}".`)
			}
			skipSpace()
			if (source[i] !== '=') reject(`Attribute ${attrName} on <${name}> needs a quoted value.`)
			i += 1
			skipSpace()
			const quote = source[i]
			if (quote !== '"' && quote !== "'")
				reject(`Attribute ${attrName} on <${name}> needs a quoted value.`)
			i += 1
			const valueStart = i
			while (i < source.length && source[i] !== quote) i += 1
			if (i >= source.length) reject(`Unterminated value for ${attrName} on <${name}>.`)
			const rawValue = source.slice(valueStart, i)
			i += 1
			attrs.push({ name: attrName, value: decodeEntities(rawValue, `${name}/@${attrName}`) })
			if (attrs.length > SPRITE_BODY_MAX_ATTRS_PER_NODE) {
				reject(`<${name}> carries too many attributes (max ${SPRITE_BODY_MAX_ATTRS_PER_NODE}).`)
			}
		}

		nodeCount += 1
		if (nodeCount > SPRITE_BODY_MAX_NODES) {
			reject(`A body is at most ${SPRITE_BODY_MAX_NODES} elements.`)
		}
		const node: ElementNode = { name, attrs, children: [] }
		const parent = stack[stack.length - 1]
		if (!parent) {
			if (root) reject('A body has exactly one root <svg>.')
			root = node
		} else {
			if (LEAF_ELEMENTS.has(parent.name)) reject(`<${parent.name}> cannot contain other elements.`)
			parent.children.push(node)
		}
		if (!selfClosing) {
			stack.push(node)
			if (stack.length > SPRITE_BODY_MAX_DEPTH) {
				reject(`Nesting is at most ${SPRITE_BODY_MAX_DEPTH} deep.`)
			}
		}
	}

	if (stack.length > 0) reject(`Unclosed <${stack[stack.length - 1]!.name}>.`)
	if (!root) reject('A body is one <svg> element.')
	return root
}

// ---------------------------------------------------------------------------
// Value validation

function parseNumberList(value: string, where: string): number[] {
	const parts = value
		.trim()
		.split(/[\s,]+/)
		.filter((p) => p.length > 0)
	const out: number[] = []
	for (const part of parts) {
		if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(part)) {
			reject(`${where} takes plain numbers (found "${part}").`)
		}
		const n = Number(part)
		if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS_NUMBER) {
			reject(`${where} has a number out of range: ${part}.`)
		}
		out.push(n)
	}
	return out
}

function validateNumericAttr(name: string, value: string, where: string): void {
	// Percentages are legitimate on gradient stops and geometry.
	const raw = value.trim().endsWith('%') ? value.trim().slice(0, -1) : value.trim()
	const list = parseNumberList(raw, `${where}/@${name}`)
	if (list.length !== 1) reject(`${where}/@${name} takes a single number.`)
}

const FUNC_RE = /^([a-zA-Z]+)\(([^()]*)\)$/

function validatePaint(value: string, where: string, refs: string[]): void {
	const v = value.trim().toLowerCase()
	if (v === 'none' || v === 'transparent') return
	if (/^#[0-9a-f]{3}$/.test(v) || /^#[0-9a-f]{6}$/.test(v) || /^#[0-9a-f]{8}$/.test(v)) return
	const urlMatch = /^url\(#([A-Za-z][A-Za-z0-9_-]{0,63})\)$/.exec(value.trim())
	if (urlMatch) {
		refs.push(urlMatch[1]!)
		return
	}
	const fn = FUNC_RE.exec(v)
	if (fn && ['rgb', 'rgba', 'hsl', 'hsla'].includes(fn[1]!)) {
		const args = fn[2]!.split(/[\s,/]+/).filter((a) => a.length > 0)
		if (args.length < 3 || args.length > 4) reject(`${where}: ${fn[1]} needs 3 or 4 values.`)
		for (const arg of args) {
			if (!/^[+-]?(?:\d+\.?\d*|\.\d+)%?(?:deg)?$/.test(arg))
				reject(`${where}: bad colour value "${arg}".`)
		}
		return
	}
	// Named colours and `currentColor` are refused on purpose: a body must be
	// self-contained and readable on both themes (§4.2), and `currentColor`
	// inherits from whatever context renders it.
	reject(
		`${where}: colours are hex, rgb()/hsl(), none, or url(#gradient) — "${value}" is not one of those.`
	)
}

function validateTransform(value: string, where: string): void {
	const trimmed = value.trim()
	if (trimmed.length === 0) return
	const re = /([a-zA-Z]+)\s*\(([^()]*)\)/g
	let consumed = 0
	let match: RegExpExecArray | null
	while ((match = re.exec(trimmed)) !== null) {
		if (!TRANSFORM_FUNCTIONS.has(match[1]!))
			reject(`${where}: unsupported transform "${match[1]}()".`)
		const args = match[2]!.trim()
		const cleaned = args.replace(/(deg|rad|turn|px|%)/g, ' ')
		parseNumberList(cleaned, `${where}/${match[1]}()`)
		consumed += match[0].length
	}
	const separators = trimmed.replace(re, '').trim()
	if (consumed === 0 || separators.replace(/[\s,]/g, '').length > 0) {
		reject(`${where}: "${value}" is not a list of transform functions.`)
	}
}

const PATH_DATA_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/

function validatePathData(value: string, where: string): void {
	if (!PATH_DATA_RE.test(value))
		reject(`${where}: path data carries only path commands and numbers.`)
	if (value.length > 8192) reject(`${where}: one path is at most 8192 characters.`)
}

// ---------------------------------------------------------------------------
// CSS

interface CssContext {
	animated: boolean
	keyframes: number
	declaredAnimations: Set<string>
	usedAnimations: Set<string>
}

/**
 * Values that make an element invisible in the RESTING frame (§4.2 静止即成立).
 *
 * Deliberately not applied inside `@keyframes`: an animation is allowed to pass
 * through opacity 0 or scale 0 on its way somewhere. What must hold is frame
 * zero with animation switched off — that is decided by the base rules and the
 * presentation attributes, which is exactly where this runs.
 */
function assertVisibleDeclaration(prop: string, value: string, where: string): void {
	if (prop === 'opacity' || prop === 'fill-opacity' || prop === 'stroke-opacity') {
		if (isZero(value)) {
			reject(
				`${where}: ${prop}:0 is invisible in the resting frame. A body must already be itself before it moves (§4.2).`
			)
		}
	}
	if (prop === 'transform') {
		SCALE_RE.lastIndex = 0
		let match: RegExpExecArray | null
		while ((match = SCALE_RE.exec(value)) !== null) {
			// Any zero factor flattens an axis, so `scale(1,0)` hides just as
			// thoroughly as `scale(0)`.
			const args = match[2]!.split(/[\s,]+/).filter((arg) => arg.length > 0)
			if (args.some(isZero)) {
				reject(`${where}: scale(0) is invisible in the resting frame (§4.2).`)
			}
		}
	}
}

/**
 * Zero, however it is spelled. The resting-visibility rule is about the NUMBER,
 * so it must not be decided by string shape: `0`, `+0`, `.0`, `0.00`, `0e0` and
 * `0%` are one value, and a regex that only knows the first two of those is a
 * rule anybody can step around by accident.
 */
function isZero(raw: string): boolean {
	const trimmed = raw.trim()
	const numeric = (trimmed.endsWith('%') ? trimmed.slice(0, -1) : trimmed).trim()
	if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(numeric)) return false
	return Number(numeric) === 0
}

/** Case-sensitive on purpose: `scaleX`/`scaleY` are spelled with capitals, and
 * the old lowercase-then-match order could never see them. */
const SCALE_RE = /\bscale([XY]?)\(([^()]*)\)/g

function validateDeclarations(
	block: string,
	where: string,
	refs: string[],
	ctx: CssContext | null,
	insideKeyframes = false
): string {
	const out: string[] = []
	for (const rawDecl of block.split(';')) {
		const decl = rawDecl.trim()
		if (decl.length === 0) continue
		const colon = decl.indexOf(':')
		if (colon < 0) reject(`${where}: "${decl}" is not a CSS declaration.`)
		const prop = decl.slice(0, colon).trim().toLowerCase()
		const value = decl.slice(colon + 1).trim()
		if (prop.startsWith('--')) reject(`${where}: custom properties are not allowed in a body.`)
		if (!CSS_PROPERTIES.has(prop)) {
			reject(`${where}: the property "${prop}" is not allowed in a body.`)
		}
		if (/[<>]/.test(value)) reject(`${where}: "${value}" is not a valid value.`)
		const lowered = value.toLowerCase()
		if (lowered.includes('url(') && !/^url\(#[A-Za-z][A-Za-z0-9_-]{0,63}\)$/.test(value.trim())) {
			reject(`${where}: url() may only reference "#" ids inside this body.`)
		}
		if (/expression\s*\(|javascript:|@import|behavior\s*:/i.test(value)) {
			reject(`${where}: "${value}" is not a valid value.`)
		}
		if (lowered.includes('!important')) {
			reject(`${where}: !important is reserved for the reduced-motion rule this server adds.`)
		}
		if (PAINT_ATTRS.has(prop)) validatePaint(value, where, refs)
		if (prop === 'transform') validateTransform(value, where)
		if (!insideKeyframes) assertVisibleDeclaration(prop, value, where)
		if (prop === 'animation' || prop === 'animation-name') {
			if (!ctx) reject(`${where}: animation belongs in a <style> block, not on an element.`)
			ctx.animated = true
			for (const token of value.split(/[\s,]+/)) {
				if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(token)) ctx.usedAnimations.add(token)
			}
		}
		out.push(`${prop}:${value}`)
	}
	return out.join(';')
}

const SELECTOR_RE = /^[A-Za-z0-9_\-.#\s,*>]+$/

function validateSelector(selector: string): string {
	const trimmed = selector.trim().replace(/\s+/g, ' ')
	if (trimmed.length === 0) reject('A style rule needs a selector.')
	if (!SELECTOR_RE.test(trimmed)) {
		reject(`Selector "${selector}" is not allowed: use element, .class and #id selectors only.`)
	}
	if (/[:[\]()]/.test(trimmed)) {
		reject(`Selector "${selector}" is not allowed: no pseudo-classes or attribute selectors.`)
	}
	return trimmed
}

/**
 * Parse the (single, merged) stylesheet. Only two constructs exist: plain rules
 * and `@keyframes`. Every other at-rule is refused — `@import` and `@font-face`
 * reach outside the body, `@media` would let a body behave differently in
 * different contexts, which is exactly what «明暗两底都要成立» forbids.
 */
function sanitizeStylesheet(css: string, refs: string[], ctx: CssContext): string {
	if (css.length > SPRITE_BODY_MAX_STYLE_BYTES) {
		reject(`The style block is at most ${SPRITE_BODY_MAX_STYLE_BYTES} bytes.`)
	}
	// Re-sanitising an already-sanitised body must be a no-op, so the rule this
	// function appends is stripped before the author's CSS is judged. Authors
	// still cannot write @media themselves.
	const source = css
		.split(REDUCED_MOTION_RULE)
		.join(' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
	const out: string[] = []
	let i = 0
	while (i < source.length) {
		while (i < source.length && /\s/.test(source[i]!)) i += 1
		if (i >= source.length) break

		if (source[i] === '@') {
			const braceAt = source.indexOf('{', i)
			if (braceAt < 0) reject('Unterminated at-rule in the style block.')
			const prelude = source.slice(i, braceAt).trim()
			const kf = /^@keyframes\s+([A-Za-z][A-Za-z0-9_-]*)$/.exec(prelude)
			if (!kf) {
				reject(`"${prelude}" is not allowed in a body: only @keyframes is.`)
			}
			ctx.keyframes += 1
			if (ctx.keyframes > SPRITE_BODY_MAX_KEYFRAMES) {
				reject(`A body defines at most ${SPRITE_BODY_MAX_KEYFRAMES} keyframe sets.`)
			}
			ctx.declaredAnimations.add(kf[1]!)
			// Find the matching close brace (keyframes nest exactly one level).
			let depth = 0
			let j = braceAt
			for (; j < source.length; j += 1) {
				if (source[j] === '{') depth += 1
				else if (source[j] === '}') {
					depth -= 1
					if (depth === 0) break
				}
			}
			if (depth !== 0) reject('Unterminated @keyframes block.')
			const body = source.slice(braceAt + 1, j)
			const frames: string[] = []
			const frameRe = /([^{}]+)\{([^{}]*)\}/g
			let frame: RegExpExecArray | null
			let matchedLength = 0
			while ((frame = frameRe.exec(body)) !== null) {
				const stop = frame[1]!.trim().replace(/\s+/g, '')
				if (!/^(?:from|to|\d{1,3}(?:\.\d+)?%)(?:,(?:from|to|\d{1,3}(?:\.\d+)?%))*$/.test(stop)) {
					reject(`"${frame[1]!.trim()}" is not a keyframe selector.`)
				}
				const decls = validateDeclarations(frame[2]!, `@keyframes ${kf[1]}`, refs, null, true)
				frames.push(`${stop}{${decls}}`)
				matchedLength += frame[0].length
			}
			if (body.replace(/\s/g, '').length > matchedLength) {
				reject(`@keyframes ${kf[1]} contains something that is not a keyframe.`)
			}
			out.push(`@keyframes ${kf[1]}{${frames.join('')}}`)
			i = j + 1
			continue
		}

		const braceAt = source.indexOf('{', i)
		if (braceAt < 0) reject('Unterminated style rule.')
		const closeAt = source.indexOf('}', braceAt)
		if (closeAt < 0) reject('Unterminated style rule.')
		const inner = source.slice(braceAt + 1, closeAt)
		if (inner.includes('{')) reject('Nested style rules are not allowed.')
		const selector = validateSelector(source.slice(i, braceAt))
		const decls = validateDeclarations(inner, `rule "${selector}"`, refs, ctx)
		if (decls.length > 0) out.push(`${selector}{${decls}}`)
		i = closeAt + 1
	}
	return out.join('')
}

// ---------------------------------------------------------------------------
// Element walk

const SHAPE_ELEMENTS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])

interface WalkState {
	ids: Set<string>
	refs: string[]
	css: CssContext
	styles: string[]
	/** How many shapes the body actually draws — zero means nothing renders. */
	shapes: number
}

function walk(node: ElementNode, state: WalkState, isRoot: boolean): ElementNode {
	if (!ELEMENTS.has(node.name)) {
		if (node.name === 'text' || node.name === 'tspan') {
			reject(
				'A body carries no <text>: words belong on the form card, rendered with real fonts (§4.2).'
			)
		}
		if (/^animate/i.test(node.name) || node.name === 'set') {
			reject(
				'SMIL animation is not allowed: use CSS animation, which the reduced-motion rule can switch off (§4.2).'
			)
		}
		if (
			node.name === 'script' ||
			node.name === 'foreignObject' ||
			node.name === 'image' ||
			node.name === 'use'
		) {
			reject(`<${node.name}> is not allowed in a body.`)
		}
		reject(`<${node.name}> is not allowed in a body.`)
	}
	if (node.name === 'svg' && !isRoot) reject('A body has exactly one <svg>, at the root.')
	if (node.name === 'style' && isRoot) reject('A body is one <svg> element.')

	// A stylesheet has no attributes worth keeping: its text is collected,
	// re-parsed against the CSS whitelist, and re-emitted as one merged block.
	if (node.name === 'style') {
		state.styles.push(decodeEntities(node.text ?? '', '<style>'))
		return { name: 'style', attrs: [], children: [] }
	}
	if (SHAPE_ELEMENTS.has(node.name)) state.shapes += 1

	const allowed = new Set([...GLOBAL_ATTRS, ...(ELEMENT_ATTRS[node.name] ?? [])])
	const kept: Attr[] = []

	for (const attr of node.attrs) {
		const lower = attr.name.toLowerCase()
		if (lower.startsWith('on')) reject(`Event handlers are not allowed (found ${attr.name}).`)
		if (lower === 'xmlns' || lower.startsWith('xmlns:')) {
			// The server emits the namespace itself; author copies are dropped.
			continue
		}
		if (lower === 'href' || lower === 'xlink:href' || lower.startsWith('xlink:')) {
			reject('External references are not allowed in a body — everything must be self-contained.')
		}
		if (isRoot && (lower === 'width' || lower === 'height')) {
			// Dropped: the served root always carries explicit pixel size derived
			// from the viewBox, so rasterisers never guess (WP-G7 lesson).
			continue
		}
		if (!allowed.has(attr.name)) {
			reject(`The attribute "${attr.name}" is not allowed on <${node.name}>.`)
		}
		if (/[<>]/.test(attr.value)) reject(`Bad value for ${attr.name} on <${node.name}>.`)

		const where = `<${node.name}>`
		if (attr.name === 'id') {
			if (!ID_RE.test(attr.value)) reject(`${where}/@id must be a simple name.`)
			if (state.ids.has(attr.value)) reject(`Duplicate id "${attr.value}".`)
			state.ids.add(attr.value)
		} else if (attr.name === 'class') {
			for (const cls of attr.value.trim().split(/\s+/)) {
				if (cls.length > 0 && !CLASS_RE.test(cls)) reject(`${where}/@class must be simple names.`)
			}
		} else if (attr.name === 'style') {
			const decls = validateDeclarations(attr.value, `${where}/@style`, state.refs, null)
			if (decls.length === 0) continue
			kept.push({ name: 'style', value: decls })
			continue
		} else if (attr.name === 'transform' || attr.name === 'gradientTransform') {
			validateTransform(attr.value, where)
		} else if (attr.name === 'd') {
			validatePathData(attr.value, where)
		} else if (attr.name === 'points') {
			parseNumberList(attr.value, `${where}/@points`)
		} else if (attr.name === 'viewBox') {
			const box = parseNumberList(attr.value, `${where}/@viewBox`)
			if (box.length !== 4 || box[2]! <= 0 || box[3]! <= 0) {
				reject('The root <svg> needs a viewBox with a positive width and height.')
			}
		} else if (attr.name === 'preserveAspectRatio') {
			if (
				!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(attr.value.trim())
			) {
				reject(`${where}/@preserveAspectRatio has an unexpected value.`)
			}
		} else if (attr.name === 'clip-path') {
			const m = /^url\(#([A-Za-z][A-Za-z0-9_-]{0,63})\)$/.exec(attr.value.trim())
			if (!m) reject(`${where}/@clip-path may only reference a clipPath in this body.`)
			state.refs.push(m[1]!)
		} else if (PAINT_ATTRS.has(attr.name)) {
			validatePaint(attr.value, `${where}/@${attr.name}`, state.refs)
		} else if (NUMERIC_ATTRS.has(attr.name)) {
			validateNumericAttr(attr.name, attr.value, where)
		} else if (ENUM_ATTRS[attr.name]) {
			if (!ENUM_ATTRS[attr.name]!.includes(attr.value.trim())) {
				reject(`${where}/@${attr.name} has an unexpected value "${attr.value}".`)
			}
		} else if (attr.name === 'stroke-dasharray') {
			parseNumberList(attr.value, `${where}/@stroke-dasharray`)
		}

		// 静止即成立 holds for PRESENTATION attributes too, `transform` included:
		// a body hidden by `transform="scale(0)"` is exactly as blank in frame 0
		// as one hidden by the CSS declaration.
		if (
			attr.name === 'opacity' ||
			attr.name === 'fill-opacity' ||
			attr.name === 'stroke-opacity' ||
			attr.name === 'transform'
		) {
			assertVisibleDeclaration(attr.name, attr.value, where)
		}
		kept.push({ name: attr.name, value: attr.value })
	}

	const children = node.children.map((child) => walk(child, state, false))
	return { name: node.name, attrs: kept, children }
}

function serialize(node: ElementNode): string {
	if (node.name === 'style') return ''
	const attrs = node.attrs.map((a) => ` ${a.name}="${encodeAttr(a.value)}"`).join('')
	const inner = node.children.map(serialize).join('')
	if (inner.length === 0) return `<${node.name}${attrs}/>`
	return `<${node.name}${attrs}>${inner}</${node.name}>`
}

// ---------------------------------------------------------------------------

const REDUCED_MOTION_RULE =
	'@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'

/**
 * Sanitize one sprite body. Returns canonical SVG, or throws
 * `SPRITE_BODY_INVALID` with a sentence the painter can act on — the author is
 * an agent, and a vague rejection costs it an entire round trip.
 */
export function sanitizeSpriteBody(input: string): SanitizedSpriteBody {
	if (typeof input !== 'string' || input.trim().length === 0) {
		reject('A body is one <svg> element.')
	}
	if (byteLength(input) > SPRITE_BODY_MAX_INPUT_BYTES) {
		reject(`A body is at most ${SPRITE_BODY_MAX_BYTES} bytes.`)
	}

	const root = parse(input.trim())
	if (root.name !== 'svg') reject('A body is one <svg> element.')

	const state: WalkState = {
		ids: new Set(),
		refs: [],
		css: {
			animated: false,
			keyframes: 0,
			declaredAnimations: new Set(),
			usedAnimations: new Set()
		},
		styles: [],
		shapes: 0
	}
	const cleaned = walk(root, state, true)

	const viewBoxAttr = cleaned.attrs.find((a) => a.name === 'viewBox')
	if (!viewBoxAttr)
		reject('The root <svg> needs a viewBox — without it nothing can be scaled safely.')
	const box = parseNumberList(viewBoxAttr.value, 'viewBox') as [number, number, number, number]

	const css = sanitizeStylesheet(state.styles.join('\n'), state.refs, state.css)

	for (const ref of state.refs) {
		if (!state.ids.has(ref)) reject(`Reference to #${ref}, which this body does not define.`)
	}
	for (const used of state.css.usedAnimations) {
		if (!state.css.declaredAnimations.has(used) && !isAnimationKeyword(used)) {
			reject(`The animation "${used}" has no @keyframes in this body.`)
		}
	}
	if (state.shapes === 0) {
		reject('This body draws nothing — it must already be itself before it moves (§4.2).')
	}

	const styleBlock = `<style>${encodeStyleText(css)}${REDUCED_MOTION_RULE}</style>`
	const width = round(box[2])
	const height = round(box[3])
	// The viewBox guard in `walk` runs before rounding, so a sub-pixel box can
	// still collapse here — and a 0×0 root is a body that renders nowhere.
	if (width <= 0 || height <= 0) {
		reject('The root <svg> needs a viewBox with a positive width and height.')
	}
	const attrs = [
		'xmlns="http://www.w3.org/2000/svg"',
		`viewBox="${box.map(round).join(' ')}"`,
		`width="${width}"`,
		`height="${height}"`,
		...cleaned.attrs
			.filter((a) => a.name !== 'viewBox')
			.map((a) => `${a.name}="${encodeAttr(a.value)}"`)
	].join(' ')
	const inner = cleaned.children.map(serialize).join('')
	const svg = `<svg ${attrs}>${styleBlock}${inner}</svg>`

	const bytes = byteLength(svg)
	if (bytes > SPRITE_BODY_MAX_BYTES) {
		reject(`A body is at most ${SPRITE_BODY_MAX_BYTES} bytes (this one is ${bytes}).`)
	}

	return {
		svg,
		nodeCount: countNodes(cleaned),
		byteLength: bytes,
		viewBox: box,
		animated: state.css.animated
	}
}

/** CSS-wide and animation shorthand keywords that are never a @keyframes name. */
const ANIMATION_KEYWORDS = new Set([
	'none',
	'initial',
	'inherit',
	'unset',
	'revert',
	'infinite',
	'normal',
	'reverse',
	'alternate',
	'forwards',
	'backwards',
	'both',
	'running',
	'paused',
	'linear',
	'ease',
	'ease-in',
	'ease-out',
	'ease-in-out',
	'step-start',
	'step-end'
])

function isAnimationKeyword(token: string): boolean {
	return ANIMATION_KEYWORDS.has(token.toLowerCase())
}

function countNodes(node: ElementNode): number {
	if (node.name === 'style') return 0
	return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0)
}

function round(value: number): number {
	return Math.round(value * 100) / 100
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).length
}

/**
 * Content address of a sanitized body. The served URL is
 * `/sprite/:ownerXid/body/:hash.svg`, immutable forever: a new body is a new
 * hash, so caches never have to be told anything.
 */
export async function spriteBodyHash(svg: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(svg))
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, 32)
}
