import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
	PLAN_ENTITLEMENTS,
	assertHandleTransition,
	assertSubscriptionTransition,
	canBindHandleClass,
	canTransitionHandle,
	canTransitionSubscription,
	degradeToFreeTier,
	entitlementForPlan,
	handleClassOf,
	isValidPrefixedId,
	makeId
} from '../src/index.js'

test('segments handle classes by length per commercialization doc §2.1', () => {
	assert.equal(handleClassOf('founder-yan'), 'standard') // 11
	assert.equal(handleClassOf('seven77'), 'standard') // 7
	assert.equal(handleClassOf('alice6'), 'compact') // 6
	assert.equal(handleClassOf('alice'), 'compact') // 5
	assert.equal(handleClassOf('yan4'), 'short') // 4
	assert.equal(handleClassOf('yan'), 'short') // 3
	assert.equal(handleClassOf('ai'), 'premium') // 2
	assert.equal(handleClassOf('y'), 'premium') // 1

	assert.throws(() => handleClassOf('UPPER'), /Invalid handle/)
	assert.throws(() => handleClassOf('-leading'), /Invalid handle/)
})

test('handle lifecycle transitions follow §6.4 topology', () => {
	assert.equal(canTransitionHandle('available', 'active'), true)
	assert.equal(canTransitionHandle('active', 'grace'), true)
	assert.equal(canTransitionHandle('grace', 'active'), true) // renewal recovery
	assert.equal(canTransitionHandle('grace', 'cooldown'), true)
	assert.equal(canTransitionHandle('cooldown', 'active'), true) // owner redemption
	assert.equal(canTransitionHandle('cooldown', 'available'), true)

	assert.equal(canTransitionHandle('active', 'cooldown'), true) // swap / account deletion
	assert.equal(canTransitionHandle('active', 'available'), false)
	assert.equal(canTransitionHandle('grace', 'available'), false) // must pass cooldown
	assert.throws(
		() => assertHandleTransition('active', 'available'),
		/Invalid handle state transition/
	)
})

test('subscription transitions mirror the provider lifecycle', () => {
	assert.equal(canTransitionSubscription('trialing', 'active'), true)
	assert.equal(canTransitionSubscription('active', 'past_due'), true)
	assert.equal(canTransitionSubscription('past_due', 'active'), true)
	assert.equal(canTransitionSubscription('canceled', 'expired'), true)

	assert.equal(canTransitionSubscription('expired', 'active'), false)
	assert.equal(canTransitionSubscription('trialing', 'past_due'), false)
	assert.throws(
		() => assertSubscriptionTransition('expired', 'active'),
		/Invalid subscription state transition/
	)
})

test('plan entitlements match the §2.1 matrix', () => {
	const free = entitlementForPlan('free')
	assert.equal(free.aiTriagePerMonth, 50)
	assert.equal(free.maxRelationships, 100)
	assert.equal(free.handleClassLimit, 'xid')
	assert.equal(free.customContract, false)
	assert.equal(free.conversationDailyTurns, 30)
	assert.equal(free.personaCustom, false)
	assert.equal(free.signalsDepth, 'counts')
	assert.equal(free.maxActiveIntents, 5)
	// 值守 is free at every tier (evidence-plan DP-E8) — it starts here.
	assert.equal(free.dutyMode, true)

	const plus = PLAN_ENTITLEMENTS.plus
	assert.equal(plus.aiTriagePerMonth, 500)
	assert.equal(plus.handleClassLimit, 'standard')
	assert.equal(plus.customContract, true)
	assert.equal(plus.aiFollowup, true)
	assert.equal(plus.valueReport, 'monthly')
	assert.equal(plus.removeBranding, false)
	assert.equal(plus.conversationDailyTurns, 100)
	assert.equal(plus.personaCustom, true)
	assert.equal(plus.signalsDepth, 'identity')
	assert.equal(plus.maxActiveIntents, 10)
	assert.equal(plus.dutyMode, true)

	const pro = PLAN_ENTITLEMENTS.pro
	assert.equal(pro.aiTriagePerMonth, 10_000)
	assert.equal(pro.maxRelationships, 5_000)
	assert.equal(pro.handleClassLimit, 'compact')
	assert.equal(pro.valueReport, 'weekly')
	assert.equal(pro.removeBranding, true)
	assert.equal(pro.conversationDailyTurns, 300)
	assert.equal(pro.signalsDepth, 'timeline')
	assert.equal(pro.dutyMode, true)

	const maxPlan = PLAN_ENTITLEMENTS.max
	assert.equal(maxPlan.aiTriagePerMonth, 30_000)
	assert.equal(maxPlan.maxRelationships, 10_000)
	assert.equal(maxPlan.handleClassLimit, 'short')
	assert.equal(maxPlan.delegateSeats, 1)
	assert.equal(maxPlan.conversationDailyTurns, 600)
	assert.equal(maxPlan.signalsDepth, 'timeline')
	assert.equal(maxPlan.dutyMode, true)
})

test('the dunning degrade pauses paid depth and nothing protective (§5.4)', () => {
	const degraded = degradeToFreeTier(PLAN_ENTITLEMENTS.pro)
	// Paid depth surfaces fall to the free tier — and 值守 no longer falls with
	// them, because the free tier carries it (DP-E8 voids DP-P5 「欠费值守暂停」).
	// An owner past due keeps their own agent at the door.
	assert.equal(degraded.dutyMode, true)
	assert.equal(degraded.materialLocker, false)
	assert.equal(degraded.autoArrange, false)
	assert.equal(degraded.personaCustom, false)
	assert.equal(degraded.aiTriagePerMonth, PLAN_ENTITLEMENTS.free.aiTriagePerMonth)
	// 欠费不撤防 / 欠费不噤声: the plan level survives everywhere else, and the
	// conversation quota falls to the free floor rather than to zero.
	assert.equal(degraded.plan, 'pro')
	assert.equal(degraded.conversationDailyTurns, PLAN_ENTITLEMENTS.free.conversationDailyTurns)
	assert.equal(degraded.maxRelationships, PLAN_ENTITLEMENTS.pro.maxRelationships)
	assert.equal(degraded.maxActiveIntents, PLAN_ENTITLEMENTS.pro.maxActiveIntents)
	assert.equal(degraded.auditVisibleDays, PLAN_ENTITLEMENTS.pro.auditVisibleDays)
})

test('handle class binding respects plan limits (§3.1 downward compatibility)', () => {
	assert.equal(canBindHandleClass('xid', 'standard'), false) // free binds nothing
	assert.equal(canBindHandleClass('standard', 'standard'), true)
	assert.equal(canBindHandleClass('standard', 'compact'), false)
	assert.equal(canBindHandleClass('compact', 'standard'), true)
	assert.equal(canBindHandleClass('compact', 'short'), false)
	assert.equal(canBindHandleClass('short', 'compact'), true)
	assert.equal(canBindHandleClass('short', 'short'), true)
	assert.equal(canBindHandleClass('short', 'premium'), false) // invite/auction only
	assert.equal(canBindHandleClass('premium', 'short'), false)
	assert.equal(canBindHandleClass('short', 'xid'), false) // xid is system-issued
})

test('generates billing id prefixes', () => {
	assert.equal(isValidPrefixedId(makeId('sub'), 'sub'), true)
	assert.equal(isValidPrefixedId(makeId('usage'), 'usage'), true)
})
