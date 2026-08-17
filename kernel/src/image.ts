/**
 * Raster image inspection for the avatar upload path (storage arch avatar
 * Phase 1). Pure, dependency-free, byte-level: no decoding, so no image
 * library and no decompression-bomb exposure — only header/segment walks.
 *
 * Three jobs, all fail-closed:
 *  - `sniffImage`  — magic-byte whitelist (WebP / PNG / JPEG only). This is
 *    the security gate: it rejects SVG/HTML (stored-XSS vectors), GIF, and
 *    anything unrecognized, so the /media origin only ever serves inert raster.
 *  - `imageDimensions` — parse width/height from the header for a sanity cap
 *    (a compressed bomb that decodes to a huge canvas hurts viewers).
 *  - `stripImageMetadata` — drop EXIF/XMP/text segments (GPS and other PII the
 *    client canvas re-encode already removes; this is the defense-in-depth
 *    against a direct upload that bypasses the browser). Also truncates
 *    anything past the image's structural end (JPEG EOI / PNG IEND / the
 *    declared RIFF size): decoders ignore those bytes, but motion-photo
 *    trailers (embedded videos) and polyglot archive tails would otherwise
 *    ride along to the public URL.
 *  - `isAnimatedWebp` — VP8X animation-flag probe, so the upload gate can
 *    reject animated WebP consistently with the GIF rejection above.
 *
 * Every walk is bounds-checked and returns null / the input unchanged rather
 * than throwing on a malformed structure; the caller treats null dimensions or
 * a null sniff as a rejection.
 */

export type ImageType = 'webp' | 'png' | 'jpeg'

export interface ImageInfo {
	type: ImageType
	/** Filename extension (no dot) for the content-addressed R2 key. */
	ext: string
	contentType: string
}

const INFO: Record<ImageType, ImageInfo> = {
	webp: { type: 'webp', ext: 'webp', contentType: 'image/webp' },
	png: { type: 'png', ext: 'png', contentType: 'image/png' },
	jpeg: { type: 'jpeg', ext: 'jpg', contentType: 'image/jpeg' }
}

/** Identify the format from magic bytes, or null for anything not whitelisted. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
	if (bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return INFO.webp
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return INFO.png
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return INFO.jpeg
	}
	return null
}

export interface Dimensions {
	width: number
	height: number
}

/** Width/height from the header, or null when it cannot be parsed. */
export function imageDimensions(bytes: Uint8Array, type: ImageType): Dimensions | null {
	switch (type) {
		case 'png':
			return pngDimensions(bytes)
		case 'jpeg':
			return jpegDimensions(bytes)
		case 'webp':
			return webpDimensions(bytes)
	}
}

/**
 * Return a copy with metadata segments removed, or the input unchanged when
 * there is nothing to strip / the structure is unexpected (never throws).
 */
export function stripImageMetadata(bytes: Uint8Array, type: ImageType): Uint8Array {
	switch (type) {
		case 'png':
			return stripPng(bytes)
		case 'jpeg':
			return stripJpeg(bytes)
		case 'webp':
			return stripWebp(bytes)
	}
}

// --- PNG -------------------------------------------------------------------

function pngDimensions(bytes: Uint8Array): Dimensions | null {
	// IHDR is always the first chunk: 8-byte signature, 4-byte length, "IHDR",
	// then width/height as big-endian u32.
	if (bytes.length < 24 || !ascii(bytes, 12, 'IHDR')) return null
	return { width: u32be(bytes, 16), height: u32be(bytes, 20) }
}

/** Ancillary chunks that only carry metadata/text — dropped on strip. */
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'])

function stripPng(bytes: Uint8Array): Uint8Array {
	const out: Uint8Array[] = [bytes.subarray(0, 8)] // signature
	let offset = 8
	let changed = false
	while (offset + 8 <= bytes.length) {
		const length = u32be(bytes, offset)
		const type = asciiOf(bytes, offset + 4, 4)
		const end = offset + 12 + length // len(4) + type(4) + data + crc(4)
		if (end > bytes.length) return bytes // truncated: leave untouched
		if (PNG_DROP.has(type)) changed = true
		else out.push(bytes.subarray(offset, end))
		if (type === 'IEND') {
			// Trailing bytes after IEND (polyglot/archive tails) are dropped too:
			// `out` already ends at the IEND chunk, so flagging is enough.
			if (end < bytes.length) changed = true
			break
		}
		offset = end
	}
	return changed ? concat(out) : bytes
}

// --- JPEG ------------------------------------------------------------------

/** Start-of-Frame markers that carry width/height (all but the DHT/DAC/RST). */
function isSof(marker: number): boolean {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	)
}

function jpegDimensions(bytes: Uint8Array): Dimensions | null {
	let offset = 2 // skip SOI
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) return null
		const marker = bytes[offset + 1]
		if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 2 // standalone marker, no length
			continue
		}
		const length = u16be(bytes, offset + 2)
		if (isSof(marker)) {
			// segment: marker(2) len(2) precision(1) height(2) width(2)
			if (offset + 9 > bytes.length) return null
			return { height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) }
		}
		if (marker === 0xda) return null // reached scan data without an SOF
		offset += 2 + length
	}
	return null
}

/** APP/COM segments that carry EXIF (E1), IPTC/Photoshop (ED) or comments (FE). */
function jpegDrops(marker: number): boolean {
	return marker === 0xe1 || marker === 0xed || marker === 0xfe
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
	const out: Uint8Array[] = [bytes.subarray(0, 2)] // SOI
	let offset = 2
	let changed = false
	while (offset + 2 <= bytes.length) {
		if (bytes[offset] !== 0xff) return bytes // not at a marker: bail unchanged
		const marker = bytes[offset + 1]
		if (marker === 0xd9) {
			// EOI: keep the marker, drop any trailer bytes behind it (motion-photo
			// videos, appended archives — decoders never read past EOI).
			out.push(bytes.subarray(offset, offset + 2))
			if (offset + 2 < bytes.length) changed = true
			break
		}
		if (marker === 0xda) {
			// Start of scan: entropy-coded data has no length field, but FF D9
			// cannot occur inside it (FF is always escaped as FF 00 or an RST
			// marker), so the first occurrence is the real EOI — copy up to it and
			// drop any trailer behind it. No EOI found: copy verbatim (truncated
			// file, leave as-is).
			const eoi = findJpegEoi(bytes, offset)
			if (eoi === -1) {
				out.push(bytes.subarray(offset))
			} else {
				out.push(bytes.subarray(offset, eoi + 2))
				if (eoi + 2 < bytes.length) changed = true
			}
			break
		}
		if (marker >= 0xd0 && marker <= 0xd7) {
			out.push(bytes.subarray(offset, offset + 2))
			offset += 2
			continue
		}
		if (offset + 4 > bytes.length) return bytes
		const length = u16be(bytes, offset + 2)
		const end = offset + 2 + length
		if (end > bytes.length) return bytes
		if (jpegDrops(marker)) changed = true
		else out.push(bytes.subarray(offset, end))
		offset = end
	}
	return changed ? concat(out) : bytes
}

// --- WebP (RIFF container) -------------------------------------------------

function webpDimensions(bytes: Uint8Array): Dimensions | null {
	if (bytes.length < 30) return null
	const fourcc = asciiOf(bytes, 12, 4)
	if (fourcc === 'VP8X') {
		// Extended: canvas width-1 / height-1 as 24-bit LE at data offset 4/7.
		return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 }
	}
	if (fourcc === 'VP8 ') {
		// Lossy: after the 10-byte frame tag comes the 3-byte start code, then
		// 14-bit LE width and height (offsets 26/28 into the file).
		return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff }
	}
	if (fourcc === 'VP8L') {
		// Lossless: 1-byte signature (0x2f) then 14-bit width-1 and height-1
		// packed little-endian across bytes 21..24.
		const b0 = bytes[21]
		const b1 = bytes[22]
		const b2 = bytes[23]
		const b3 = bytes[24]
		const width = ((b1 & 0x3f) << 8) | (b0 & 0xff)
		const height = ((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)
		return { width: width + 1, height: height + 1 }
	}
	return null
}

function stripWebp(bytes: Uint8Array): Uint8Array {
	if (bytes.length < 12) return bytes
	// Truncate past the declared RIFF size first: readers stop there, but a
	// trailer (appended archive/video) would otherwise ride along to R2.
	const riffSize = u32le(bytes, 4)
	const declaredEnd = 8 + riffSize + (riffSize & 1)
	let changed = false
	if (declaredEnd >= 12 && declaredEnd < bytes.length) {
		bytes = bytes.subarray(0, declaredEnd)
		changed = true
	}
	// Simple (VP8 / VP8L) files carry no metadata chunks — nothing else to strip.
	const fourcc = asciiOf(bytes, 12, 4)
	if (fourcc !== 'VP8X') return bytes

	const out: Uint8Array[] = [bytes.subarray(0, 12)] // 'RIFF' size 'WEBP'
	let offset = 12
	while (offset + 8 <= bytes.length) {
		const type = asciiOf(bytes, offset, 4)
		const size = u32le(bytes, offset + 4)
		const padded = size + (size & 1) // chunks are 2-byte aligned
		const end = offset + 8 + padded
		if (end > bytes.length) return bytes // truncated
		if (type === 'EXIF' || type === 'XMP ') {
			changed = true
		} else if (type === 'VP8X') {
			// Clear the EXIF (bit3) and XMP (bit2) flags so a decoder does not look
			// for the chunks we are dropping; keep ICC/Alpha/Animation intact.
			const chunk = bytes.slice(offset, end)
			if ((chunk[8] & 0x0c) !== 0) {
				chunk[8] &= ~0x0c
				changed = true
			}
			out.push(chunk)
		} else {
			out.push(bytes.subarray(offset, end))
		}
		offset = end
	}
	if (!changed) return bytes
	const body = concat(out)
	// Fix the RIFF size field (total length minus the 8-byte 'RIFF'+size header).
	writeU32le(body, 4, body.length - 8)
	return body
}

/**
 * True when a WebP declares animation (the VP8X ANIM flag). Simple VP8/VP8L
 * files cannot animate; a flagless ANMF chunk is malformed and decoders show
 * only the still frame, so the flag byte is the whole decision.
 */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
	if (bytes.length < 21 || asciiOf(bytes, 12, 4) !== 'VP8X') return false
	return (bytes[20] & 0x02) !== 0
}

/** First FF D9 (EOI) at/after `from`, or -1. See stripJpeg for why this is safe. */
function findJpegEoi(bytes: Uint8Array, from: number): number {
	for (let i = from; i + 1 < bytes.length; i++) {
		if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return i
	}
	return -1
}

// --- byte helpers ----------------------------------------------------------

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		if (bytes[at + i] !== text.charCodeAt(i)) return false
	}
	return true
}

function asciiOf(bytes: Uint8Array, at: number, len: number): string {
	let s = ''
	for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[at + i])
	return s
}

function u16be(b: Uint8Array, at: number): number {
	return (b[at] << 8) | b[at + 1]
}

function u32be(b: Uint8Array, at: number): number {
	return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
}

function u16le(b: Uint8Array, at: number): number {
	return b[at] | (b[at + 1] << 8)
}

function u24le(b: Uint8Array, at: number): number {
	return b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
}

function u32le(b: Uint8Array, at: number): number {
	return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
}

function writeU32le(b: Uint8Array, at: number, value: number): void {
	b[at] = value & 0xff
	b[at + 1] = (value >>> 8) & 0xff
	b[at + 2] = (value >>> 16) & 0xff
	b[at + 3] = (value >>> 24) & 0xff
}

function concat(parts: Uint8Array[]): Uint8Array {
	let total = 0
	for (const part of parts) total += part.length
	const out = new Uint8Array(total)
	let at = 0
	for (const part of parts) {
		out.set(part, at)
		at += part.length
	}
	return out
}
