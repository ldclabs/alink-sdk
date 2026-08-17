/**
 * Visitor-memory snapshot (assistant-memory doc §3.3) — the ONLY shape the
 * distillation pipeline may persist.
 *
 * INV-M4 is enforced by construction, not policy: the schema has no field for
 * triage outcomes, gate/rule feedback, contract internals or visitor location,
 * and `state` deliberately has no 'declined' value — a model that tries to
 * remember "the gate rejected him" simply has nowhere to put it. The
 * normalizer clamps arbitrary model output to this schema (unknown keys
 * dropped, lengths clipped, counts capped) and the serialized whole is
 * hard-capped at MEMORY_SNAPSHOT_MAX_CHARS — a distillation-quality bound
 * (assistant-memory §3.6), independent of the prompt budget.
 */

export interface MemorySnapshotIdentity {
	/** Self-claimed, unverified — the prompt presents these as claims. */
	name?: string
	org?: string
	role?: string
}

export interface MemorySnapshotTopic {
	summary: string
	/** No 'declined' by design (INV-M4): outcomes of the owner's gate are not
	 * memory material. */
	state: 'open' | 'asked' | 'converged'
	/** unix ms of the session that produced/updated this thread. */
	at: number
}

export interface MemorySnapshot {
	identity?: MemorySnapshotIdentity
	topics: MemorySnapshotTopic[]
	prefs?: { locale?: string; note?: string }
	openLoops: string[]
}

export const MEMORY_SNAPSHOT_MAX_CHARS = 2_000
const IDENTITY_FIELD_MAX = 80
const TOPIC_SUMMARY_MAX = 120
const TOPICS_MAX = 5
const PREFS_NOTE_MAX = 200
const OPEN_LOOP_MAX = 200
const OPEN_LOOPS_MAX = 3
const TOPIC_STATES = new Set(['open', 'asked', 'converged'])

const clipString = (value: unknown, max: number): string | undefined => {
	if (typeof value !== 'string') return undefined
	const trimmed = value.trim()
	return trimmed ? trimmed.slice(0, max) : undefined
}

/**
 * Clamp arbitrary (model-produced, therefore untrusted) output to the
 * snapshot schema. Returns null when nothing worth storing survives — the
 * caller then stamps the session distilled without writing a row.
 */
export function normalizeMemorySnapshot(raw: unknown, now: number): MemorySnapshot | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
	const value = raw as Record<string, unknown>

	const identityRaw = (value.identity ?? {}) as Record<string, unknown>
	const identity: MemorySnapshotIdentity = {
		...(clipString(identityRaw.name, IDENTITY_FIELD_MAX)
			? { name: clipString(identityRaw.name, IDENTITY_FIELD_MAX) }
			: {}),
		...(clipString(identityRaw.org, IDENTITY_FIELD_MAX)
			? { org: clipString(identityRaw.org, IDENTITY_FIELD_MAX) }
			: {}),
		...(clipString(identityRaw.role, IDENTITY_FIELD_MAX)
			? { role: clipString(identityRaw.role, IDENTITY_FIELD_MAX) }
			: {})
	}

	const topics: MemorySnapshotTopic[] = Array.isArray(value.topics)
		? value.topics
				.flatMap((entry): MemorySnapshotTopic[] => {
					const topic = (entry ?? {}) as Record<string, unknown>
					const summary = clipString(topic.summary, TOPIC_SUMMARY_MAX)
					if (!summary) return []
					const state =
						typeof topic.state === 'string' && TOPIC_STATES.has(topic.state)
							? (topic.state as MemorySnapshotTopic['state'])
							: 'open'
					const at =
						typeof topic.at === 'number' && Number.isFinite(topic.at) && topic.at > 0
							? Math.min(topic.at, now)
							: now
					return [{ summary, state, at }]
				})
				.slice(0, TOPICS_MAX)
		: []

	const prefsRaw = (value.prefs ?? {}) as Record<string, unknown>
	const prefs = {
		...(clipString(prefsRaw.locale, 35) ? { locale: clipString(prefsRaw.locale, 35) } : {}),
		...(clipString(prefsRaw.note, PREFS_NOTE_MAX)
			? { note: clipString(prefsRaw.note, PREFS_NOTE_MAX) }
			: {})
	}

	const openLoops = Array.isArray(value.openLoops)
		? value.openLoops
				.map((loop) => clipString(loop, OPEN_LOOP_MAX))
				.filter((loop): loop is string => Boolean(loop))
				.slice(0, OPEN_LOOPS_MAX)
		: []

	const snapshot: MemorySnapshot = {
		...(Object.keys(identity).length ? { identity } : {}),
		topics,
		...(Object.keys(prefs).length ? { prefs } : {}),
		openLoops
	}
	if (!snapshot.identity && !snapshot.prefs && topics.length === 0 && openLoops.length === 0) {
		return null
	}

	// Whole-snapshot cap: shed the least essential material first (open loops,
	// then oldest topic threads, then the free-text pref note).
	while (JSON.stringify(snapshot).length > MEMORY_SNAPSHOT_MAX_CHARS) {
		if (snapshot.openLoops.length > 0) snapshot.openLoops.pop()
		else if (snapshot.topics.length > 0) {
			snapshot.topics.sort((a, b) => b.at - a.at).pop()
		} else if (snapshot.prefs?.note) {
			delete snapshot.prefs.note
			if (Object.keys(snapshot.prefs).length === 0) delete snapshot.prefs
		} else if (snapshot.identity) {
			delete snapshot.identity
		} else {
			return null
		}
	}
	return snapshot
}
