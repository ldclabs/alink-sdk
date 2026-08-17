import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
	imageDimensions,
	isAnimatedWebp,
	sniffImage,
	stripImageMetadata
} from '../src/index.js'

// --- fixture builders (structurally valid; not renderable) ------------------

function bytes(...parts) {
	const flat = []
	for (const p of parts) {
		if (typeof p === 'number') flat.push(p & 0xff)
		else for (const b of p) flat.push(b & 0xff)
	}
	return new Uint8Array(flat)
}

const ascii = (s) => [...s].map((c) => c.charCodeAt(0))
const u32be = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const u16be = (n) => [(n >>> 8) & 0xff, n & 0xff]
const u32le = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
const u24le = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff]

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const pngChunk = (type, data) => bytes(u32be(data.length), ascii(type), data, [0, 0, 0, 0])

function makePng({ width = 7, height = 5, withText = true } = {}) {
	const ihdr = bytes(u32be(width), u32be(height), [0x08, 0x06, 0x00, 0x00, 0x00])
	const chunks = [pngChunk('IHDR', ihdr)]
	if (withText) chunks.push(pngChunk('tEXt', ascii('Comment\0secret gps')))
	chunks.push(pngChunk('IDAT', [0x00]))
	chunks.push(pngChunk('IEND', []))
	return bytes(PNG_SIG, ...chunks)
}

function makeJpeg({ width = 9, height = 4, withExif = true } = {}) {
	const parts = [[0xff, 0xd8]] // SOI
	if (withExif) {
		const payload = ascii('Exif\0\0GPS:1,2')
		parts.push([0xff, 0xe1], u16be(payload.length + 2), payload)
	}
	// SOF0: precision, height, width, components=1, [id, hv, q]
	const sof = bytes([0x08], u16be(height), u16be(width), [0x01, 0x01, 0x11, 0x00])
	parts.push([0xff, 0xc0], u16be(sof.length + 2), sof)
	parts.push([0xff, 0xda], u16be(2), [0x00, 0x11, 0x22]) // SOS + entropy data
	parts.push([0xff, 0xd9]) // EOI
	return bytes(...parts)
}

function webpChunk(type, data) {
	const padded = data.length & 1 ? [...data, 0] : data
	return bytes(ascii(type), u32le(data.length), padded)
}

function makeWebpVp8x({ width = 12, height = 8, withExif = true } = {}) {
	const flags = withExif ? 0x08 : 0x00 // EXIF bit
	const vp8x = webpChunk('VP8X', bytes([flags, 0, 0, 0], u24le(width - 1), u24le(height - 1)))
	const vp8 = webpChunk('VP8 ', [0x00, 0x01, 0x02, 0x03])
	const body = withExif ? bytes(vp8x, vp8, webpChunk('EXIF', ascii('GPS:1,2'))) : bytes(vp8x, vp8)
	const withHeader = bytes(ascii('WEBP'), body)
	return bytes(ascii('RIFF'), u32le(withHeader.length), withHeader)
}

// --- sniff ------------------------------------------------------------------

test('sniffImage whitelists webp/png/jpeg and rejects everything else', () => {
	assert.equal(sniffImage(makePng()).type, 'png')
	assert.equal(sniffImage(makeJpeg()).type, 'jpeg')
	assert.equal(sniffImage(makeWebpVp8x()).type, 'webp')
	assert.equal(sniffImage(makeWebpVp8x()).ext, 'webp')
	assert.equal(sniffImage(makeJpeg()).ext, 'jpg')
	// Stored-XSS and other vectors are rejected.
	assert.equal(sniffImage(bytes(ascii('<svg xmlns='))), null)
	assert.equal(sniffImage(bytes(ascii('<!DOCTYPE html>'))), null)
	assert.equal(sniffImage(bytes(ascii('GIF89a'))), null)
	assert.equal(sniffImage(bytes([0x00, 0x01, 0x02])), null)
	assert.equal(sniffImage(new Uint8Array()), null)
})

// --- dimensions -------------------------------------------------------------

test('imageDimensions reads the header for each format', () => {
	assert.deepEqual(imageDimensions(makePng({ width: 7, height: 5 }), 'png'), {
		width: 7,
		height: 5
	})
	assert.deepEqual(imageDimensions(makeJpeg({ width: 9, height: 4 }), 'jpeg'), {
		width: 9,
		height: 4
	})
	assert.deepEqual(imageDimensions(makeWebpVp8x({ width: 12, height: 8 }), 'webp'), {
		width: 12,
		height: 8
	})
})

test('imageDimensions returns null on a truncated/garbage header', () => {
	assert.equal(imageDimensions(new Uint8Array([1, 2, 3]), 'png'), null)
	assert.equal(imageDimensions(new Uint8Array([0xff, 0xd8]), 'jpeg'), null)
	assert.equal(imageDimensions(new Uint8Array([1, 2, 3]), 'webp'), null)
})

// --- metadata stripping -----------------------------------------------------

test('stripImageMetadata drops PNG text chunks, keeps image data + dims', () => {
	const original = makePng({ withText: true })
	const stripped = stripImageMetadata(original, 'png')
	assert.ok(stripped.length < original.length)
	assert.ok(!includes(stripped, 'tEXt'))
	assert.ok(includes(stripped, 'IDAT') && includes(stripped, 'IEND'))
	assert.equal(sniffImage(stripped).type, 'png')
	assert.deepEqual(imageDimensions(stripped, 'png'), { width: 7, height: 5 })
})

test('stripImageMetadata drops the JPEG APP1/EXIF segment, keeps scan + dims', () => {
	const original = makeJpeg({ withExif: true })
	const stripped = stripImageMetadata(original, 'jpeg')
	assert.ok(stripped.length < original.length)
	assert.ok(!includes(stripped, 'Exif'))
	assert.equal(sniffImage(stripped).type, 'jpeg')
	assert.deepEqual(imageDimensions(stripped, 'jpeg'), { width: 9, height: 4 })
	// EOI is preserved.
	assert.equal(stripped[stripped.length - 2], 0xff)
	assert.equal(stripped[stripped.length - 1], 0xd9)
})

test('stripImageMetadata drops the WebP EXIF chunk, clears the VP8X flag, fixes RIFF size', () => {
	const original = makeWebpVp8x({ withExif: true })
	const stripped = stripImageMetadata(original, 'webp')
	assert.ok(!includes(stripped, 'EXIF'))
	// VP8X flags byte (offset 20) no longer advertises EXIF.
	assert.equal(stripped[20] & 0x08, 0)
	// RIFF size field matches the new body length.
	const declared = stripped[4] | (stripped[5] << 8) | (stripped[6] << 16) | (stripped[7] << 24)
	assert.equal(declared, stripped.length - 8)
	assert.equal(sniffImage(stripped).type, 'webp')
	assert.deepEqual(imageDimensions(stripped, 'webp'), { width: 12, height: 8 })
})

test('stripImageMetadata is a no-op (and idempotent) when there is nothing to strip', () => {
	for (const [make, type] of [
		[() => makePng({ withText: false }), 'png'],
		[() => makeJpeg({ withExif: false }), 'jpeg'],
		[() => makeWebpVp8x({ withExif: false }), 'webp']
	]) {
		const clean = make()
		const once = stripImageMetadata(clean, type)
		assert.deepEqual([...once], [...clean], `${type} clean image unchanged`)
		const twice = stripImageMetadata(stripImageMetadata(make({}), type), type)
		const single = stripImageMetadata(make(), type)
		assert.deepEqual([...twice], [...single], `${type} strip is idempotent`)
	}
})

test('stripImageMetadata truncates trailer bytes past the image end', () => {
	// Motion-photo style: a video/archive payload appended after the image
	// structure ends — decoders ignore it, so it must not reach the public URL.
	const jpeg = makeJpeg({ withExif: false })
	const jpegTrailed = bytes(jpeg, ascii('ftypmp4-video-payload'))
	assert.deepEqual([...stripImageMetadata(jpegTrailed, 'jpeg')], [...jpeg])

	const png = makePng({ withText: false })
	const pngTrailed = bytes(png, ascii('PK-zip-tail'))
	assert.deepEqual([...stripImageMetadata(pngTrailed, 'png')], [...png])

	const webp = makeWebpVp8x({ withExif: false })
	const webpTrailed = bytes(webp, ascii('trailing-junk'))
	assert.deepEqual([...stripImageMetadata(webpTrailed, 'webp')], [...webp])
})

test('isAnimatedWebp flags exactly the VP8X ANIM bit', () => {
	assert.equal(isAnimatedWebp(makeWebpVp8x()), false)
	const animated = makeWebpVp8x()
	animated[20] |= 0x02
	assert.equal(isAnimatedWebp(animated), true)
	// Simple (non-VP8X) files can never animate.
	const simple = bytes(
		ascii('RIFF'),
		u32le(12),
		ascii('WEBP'),
		ascii('VP8 '),
		u32le(4),
		[0, 0, 0, 0]
	)
	assert.equal(isAnimatedWebp(simple), false)
})

function includes(haystack, text) {
	const needle = [...text].map((c) => c.charCodeAt(0))
	outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
		return true
	}
	return false
}
