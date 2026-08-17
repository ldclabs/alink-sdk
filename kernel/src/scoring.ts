import type { RelationshipPermissionLevel } from './types.js'

export interface TemperatureInput {
	recencyScore: number
	interactionDepth: number
	mutuality: number
	permissionStrength: number
	positiveFeedback: number
}

export interface MatchScoreInput {
	/** Topic/keyword overlap between the intent and the relationship (0–1). */
	topicOverlap: number
	relationshipTemperature: number
	permissionFit: number
	pathQuality: number
	freshness: number
	reciprocity: number
}

export function calculateRelationshipTemperature(input: TemperatureInput): number {
	return roundScore(
		0.3 * clamp01(input.recencyScore) +
			0.25 * clamp01(input.interactionDepth) +
			0.2 * clamp01(input.mutuality) +
			0.15 * clamp01(input.permissionStrength) +
			0.1 * clamp01(input.positiveFeedback)
	)
}

export function calculateMatchScore(input: MatchScoreInput): number {
	return roundScore(
		0.35 * clamp01(input.topicOverlap) +
			0.2 * clamp01(input.relationshipTemperature) +
			0.15 * clamp01(input.permissionFit) +
			0.15 * clamp01(input.pathQuality) +
			0.1 * clamp01(input.freshness) +
			0.05 * clamp01(input.reciprocity)
	)
}

export interface DiscoveryScoreInput {
	/** bm25 text relevance, min-max normalized within the candidate batch (0–1). */
	textRelevance: number
	/** Second-degree bridge quality (discovery design D7): 0.9 trusted/collaborator
	 * bridge, 0.6 other qualifying bridge, 0.2 pure stranger. */
	pathQuality: number
	/** Candidate intent recency: linear decay over 120 days from updated_at. */
	freshness: number
	/** Jaccard topic overlap between the two intents (topicSimilarity). */
	topicOverlap: number
}

/**
 * Network-wide discovery ranking (discovery design D7). Deliberately NOT
 * MatchScoreInput: strangers have no relationship temperature and no standing
 * permission — reusing the first-degree formula would zero two terms and
 * distort every weight. Rerank runs in-worker on the requester's side; the
 * global index only recalls (D1 两段式).
 */
export function calculateDiscoveryScore(input: DiscoveryScoreInput): number {
	return roundScore(
		0.45 * clamp01(input.textRelevance) +
			0.25 * clamp01(input.pathQuality) +
			0.15 * clamp01(input.freshness) +
			0.15 * clamp01(input.topicOverlap)
	)
}

/**
 * Jaccard topic overlap with a 0.3 unknown-prior when either side declares no
 * topics (shared by intent.match_relationships and intent.discover — moved
 * here from services/tools/intents.ts so both paths score identically).
 */
export function topicSimilarity(left: readonly string[], right: readonly string[]): number {
	if (left.length === 0 || right.length === 0) return 0.3
	const rightSet = new Set(right)
	const overlap = left.filter((topic) => rightSet.has(topic)).length
	const union = new Set([...left, ...right]).size
	return union === 0 ? 0 : overlap / union
}

export function permissionFitScore(level: RelationshipPermissionLevel): number {
	switch (level) {
		case 'auto_allowed':
			return 1
		case 'approval_required':
			return 0.65
		case 'draft_only':
			return 0.35
		case 'denied':
			return 0
	}
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.min(1, Math.max(0, value))
}

function roundScore(value: number): number {
	return Math.round(value * 100) / 100
}
