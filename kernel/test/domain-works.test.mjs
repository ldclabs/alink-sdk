import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
	WORK_KINDS,
	WORK_RENDERER_MAJOR,
	WORK_RENDERER_PREFIX,
	buildWorkEntryDocument,
	isRenderedWorkKind,
	isWorkKind,
	probeWorkEntryBytes,
	resolveWorkEntry,
	workContentKindForPath,
	workRendererBasePath,
	workRendererName,
	workRendererObjectKey
} from '../src/index.js'

const bytes = (...values) => new Uint8Array(values)
const text = (value) => new TextEncoder().encode(value)

// ---------------------------------------------------------------------------
// Kinds

test('kinds are a closed set with page first', () => {
	assert.deepEqual([...WORK_KINDS], ['page', 'doc', 'pdf', 'video', 'audio', 'image', 'script'])
	assert.ok(isWorkKind('doc'))
	assert.ok(!isWorkKind('slides'))
	assert.ok(!isRenderedWorkKind('page'))
	assert.ok(isRenderedWorkKind('pdf'))
})

test('only content extensions map to a kind — assets do not', () => {
	assert.equal(workContentKindForPath('paper.md'), 'doc')
	assert.equal(workContentKindForPath('a/b/film.MP4'), 'video')
	assert.equal(workContentKindForPath('main.mjs'), 'script')
	// Assets a work is MADE of are never the thing a visitor came to see.
	assert.equal(workContentKindForPath('data.json'), null)
	assert.equal(workContentKindForPath('model.glb'), null)
	assert.equal(workContentKindForPath('captions.vtt'), null)
	// A page is decided by its root index.html, never by extension.
	assert.equal(workContentKindForPath('index.html'), null)
})

// ---------------------------------------------------------------------------
// Entry resolution (§5.2)

test('a root index.html is a page, before anything else is examined', () => {
	assert.deepEqual(resolveWorkEntry(['index.html', 'app.js', 'hero.png']), {
		ok: true,
		kind: 'page',
		entryPath: 'index.html'
	})
	// An old work can never be re-interpreted into a new kind, whatever else
	// happens to be lying next to its entry.
	assert.deepEqual(resolveWorkEntry(['index.html', 'notes.md']), {
		ok: true,
		kind: 'page',
		entryPath: 'index.html'
	})
})

test('single content files resolve to their kind', () => {
	for (const [path, kind] of [
		['paper.md', 'doc'],
		['thesis.pdf', 'pdf'],
		['film.mp4', 'video'],
		['talk.mp3', 'audio'],
		['poster.png', 'image'],
		['main.js', 'script']
	]) {
		assert.deepEqual(resolveWorkEntry([path]), { ok: true, kind, entryPath: path })
	}
})

test('priority runs from the strongest signal to the weakest', () => {
	// Markdown ships images; the images are assets.
	assert.deepEqual(resolveWorkEntry(['paper.md', 'chart.png', 'photo.jpg']), {
		ok: true,
		kind: 'doc',
		entryPath: 'paper.md'
	})
	// A sketch ships textures and models.
	assert.deepEqual(resolveWorkEntry(['main.js', 'sky.png', 'model.glb']), {
		ok: true,
		kind: 'script',
		entryPath: 'main.js'
	})
	// A video ships a poster and captions.
	assert.deepEqual(resolveWorkEntry(['film.mp4', 'poster.jpg', 'captions.vtt']), {
		ok: true,
		kind: 'video',
		entryPath: 'film.mp4'
	})
})

test('two candidates of the winning kind refuse rather than guess', () => {
	const result = resolveWorkEntry(['a.md', 'b.md'])
	assert.equal(result.ok, false)
	assert.equal(result.reason, 'ambiguous')
	// The refusal names both files: the failure mode being avoided is one of
	// them silently becoming an invisible asset.
	assert.match(result.message, /a\.md/)
	assert.match(result.message, /b\.md/)
})

test('the content file must sit at the root', () => {
	const result = resolveWorkEntry(['docs/paper.md', 'docs/chart.png'])
	assert.equal(result.ok, false)
	assert.equal(result.reason, 'no_entry')
})

test('nothing openable is a refusal, not an empty work', () => {
	const result = resolveWorkEntry(['data.json', 'notes.txt'])
	assert.equal(result.ok, false)
	assert.equal(result.reason, 'no_entry')
})

test('a declared kind is honoured and checked, never trusted', () => {
	// Declaring disambiguates what priority alone could not.
	assert.deepEqual(resolveWorkEntry(['cover.png', 'paper.pdf'], 'image'), {
		ok: true,
		kind: 'image',
		entryPath: 'cover.png'
	})
	const missing = resolveWorkEntry(['paper.md'], 'video')
	assert.equal(missing.ok, false)
	assert.equal(missing.reason, 'kind_mismatch')
	const pageWithoutIndex = resolveWorkEntry(['paper.md'], 'page')
	assert.equal(pageWithoutIndex.ok, false)
	assert.equal(pageWithoutIndex.reason, 'no_entry')
	const indexAsDoc = resolveWorkEntry(['index.html'], 'doc')
	assert.equal(indexAsDoc.ok, false)
	assert.equal(indexAsDoc.reason, 'kind_mismatch')
	const unknown = resolveWorkEntry(['paper.md'], 'slides')
	assert.equal(unknown.ok, false)
	assert.equal(unknown.reason, 'kind_mismatch')
})

// ---------------------------------------------------------------------------
// Probes (§10.2) — slip guards, never security controls

test('probes catch a mis-picked file and pass everything plausible', () => {
	assert.equal(probeWorkEntryBytes('page', 'index.html', text('<!doctype html>')), null)
	assert.match(probeWorkEntryBytes('page', 'index.html', text('plain')), /HTML/)
	assert.equal(probeWorkEntryBytes('doc', 'paper.md', text('# Title')), null)
	assert.equal(probeWorkEntryBytes('doc', 'paper.md', bytes(0xff, 0xfe, 0x00)) !== null, true)
	assert.equal(probeWorkEntryBytes('pdf', 'a.pdf', text('%PDF-1.7')), null)
	assert.match(probeWorkEntryBytes('pdf', 'a.pdf', text('not a pdf')), /PDF/)
	assert.equal(probeWorkEntryBytes('image', 'a.png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d)), null)
	assert.match(probeWorkEntryBytes('image', 'a.png', bytes(0x00, 0x01, 0x02, 0x03)), /PNG/)
	assert.equal(probeWorkEntryBytes('image', 'a.svg', text('<svg viewBox="0 0 1 1">')), null)
	assert.equal(
		probeWorkEntryBytes('video', 'a.mp4', bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70)),
		null
	)
	assert.equal(probeWorkEntryBytes('audio', 'a.mp3', text('ID3')), null)
	assert.equal(probeWorkEntryBytes('audio', 'a.mp3', bytes(0xff, 0xfb, 0x90)), null)
	// An extension with no signature on file passes: the list grows by evidence.
	assert.equal(probeWorkEntryBytes('image', 'a.gif', bytes(0x47, 0x49, 0x46, 0x38)), null)
	assert.equal(probeWorkEntryBytes('script', 'main.js', text('export default 1')), null)
})

// ---------------------------------------------------------------------------
// Renderer addressing (§8)

test('video and audio share one renderer, everything else has its own', () => {
	assert.equal(workRendererName('video'), 'media')
	assert.equal(workRendererName('audio'), 'media')
	assert.equal(workRendererName('doc'), 'doc')
	assert.equal(workRendererName('pdf'), 'pdf')
})

test('a probe reads a PREFIX, so a character split by the cut is not an error', () => {
	// ⚠️ The regression this locks: 32 KB of Chinese markdown ends mid-character
	// two times out of three, and a fatal decode without streaming called that
	// an encoding error — refusing the work and deleting its upload.
	const full = new TextEncoder().encode('# 城市灯火\n\n夜里走过这座城市。'.repeat(4))
	for (const cut of [full.length - 1, full.length - 2]) {
		assert.equal(probeWorkEntryBytes('doc', 'paper.md', full.slice(0, cut)), null)
	}
	// A real binary is still caught: the streaming decoder only forgives an
	// INCOMPLETE tail, never an invalid lead byte.
	assert.ok(probeWorkEntryBytes('doc', 'paper.md', bytes(0xff, 0xfe, 0x41, 0x42)) !== null)
})

test('renderer assets are addressed by version and live under the reserved prefix', () => {
	const base = workRendererBasePath('doc')
	assert.match(base, /^\/-\/r\/doc\/1\.[0-9a-z]+\/$/)
	const key = workRendererObjectKey('doc', `${WORK_RENDERER_MAJOR}.20260818a`, 'index.js')
	assert.equal(key, `${WORK_RENDERER_PREFIX}doc/1.20260818a/index.js`)
	// ⚠️ The reserved prefix can never be reached from a user object key.
	assert.ok(key.startsWith('platform/'))
	// Traversal and shapes outside the contract are refused outright.
	assert.equal(workRendererObjectKey('doc', '1.20260818a', '../../works/x/y.html'), null)
	assert.equal(workRendererObjectKey('../doc', '1.20260818a', 'index.js'), null)
	assert.equal(workRendererObjectKey('doc', 'latest', 'index.js'), null)
})

// ---------------------------------------------------------------------------
// The synthesized entry document (§7.3)

test('the entry document carries owner text only through the JSON block', () => {
	const html = buildWorkEntryDocument({
		kind: 'doc',
		entryPath: 'paper.md',
		title: '</script><img src=x onerror=alert(1)>',
		locale: 'zh'
	})
	// The `<` of an injected tag survives nowhere as markup.
	assert.ok(!html.includes('<img src=x'))
	assert.ok(html.includes('\\u003c/script'))
	assert.ok(html.includes('<html lang="zh">'))
	// The content file is referenced relatively, so the signed preview prefix
	// is inherited for free and 预览即所得 needs no second code path.
	assert.ok(html.includes('"src":"./paper.md"'))
	// The renderer is NOT part of the work: absolute path, no inheritance.
	assert.ok(html.includes(`src="${workRendererBasePath('doc')}index.js"`))
})

test('the entry document is addressed and stamped with the work\u2019s own major', () => {
	// One major ships today; what this pins is that the payload's `v` and the
	// renderer's address can never disagree — a v1 work handed a v2 contract is
	// the failure mode the row's `render_major` exists to prevent.
	const html = buildWorkEntryDocument({
		kind: 'doc',
		entryPath: 'paper.md',
		title: 'x',
		renderMajor: WORK_RENDERER_MAJOR
	})
	assert.ok(html.includes(`"v":${WORK_RENDERER_MAJOR}`))
	assert.ok(html.includes(`src="${workRendererBasePath('doc', WORK_RENDERER_MAJOR)}index.js"`))
	// A major nobody ships (a rollback, a hand-edited row) must still address a
	// directory that EXISTS — a blank stage is worse than the newest renderer.
	const stale = buildWorkEntryDocument({
		kind: 'doc',
		entryPath: 'paper.md',
		title: 'x',
		renderMajor: 99
	})
	assert.ok(stale.includes(`/-/r/doc/${WORK_RENDERER_MAJOR}.`))
})

test('a bad locale falls back rather than reaching the document element', () => {
	const html = buildWorkEntryDocument({
		kind: 'image',
		entryPath: 'a.png',
		title: 'x',
		locale: '"><script>'
	})
	assert.ok(html.includes('<html lang="en">'))
})
