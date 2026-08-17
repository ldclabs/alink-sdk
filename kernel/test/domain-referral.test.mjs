import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
	DEFAULT_REFERRAL_PARAMS,
	REFERRAL_PARAMS_VERSION,
	REFERRAL_TRANSITIONS,
	assertReferralTransition,
	canTransitionReferral,
	isReservedHandle,
	makeId
} from '../src/index.js'

test('referral state machine topology (credits doc §10.2)', () => {
	assert.ok(canTransitionReferral('pending', 'qualified'))
	assert.ok(canTransitionReferral('pending', 'rejected'))
	assert.ok(canTransitionReferral('pending', 'expired'))
	assert.ok(canTransitionReferral('qualified', 'rewarded'))
	assert.ok(canTransitionReferral('qualified', 'forfeited'))
	assert.ok(canTransitionReferral('qualified', 'rejected'))

	// Attribution is immutable and the row only ever advances; rewarded is
	// terminal — a counted conversion is never clawed back (credits doc §3.5).
	assert.ok(!canTransitionReferral('qualified', 'pending'))
	assert.ok(!canTransitionReferral('rewarded', 'qualified'))
	assert.ok(!canTransitionReferral('pending', 'rewarded'))
	for (const terminal of ['rewarded', 'rejected', 'expired', 'forfeited']) {
		assert.deepEqual(REFERRAL_TRANSITIONS[terminal], [])
	}
	assert.throws(() => assertReferralTransition('rewarded', 'pending'), {
		code: 'INVALID_STATE_TRANSITION'
	})
})

test('referral params defaults (credits doc §10.3)', () => {
	assert.equal(DEFAULT_REFERRAL_PARAMS.version, REFERRAL_PARAMS_VERSION)
	// The 14-day hold doubles as the §3.6 privacy blur — never below daily-batch.
	assert.equal(DEFAULT_REFERRAL_PARAMS.rewardHoldDays, 14)
	assert.equal(DEFAULT_REFERRAL_PARAMS.referrerPastDueGraceDays, 30)
	assert.equal(DEFAULT_REFERRAL_PARAMS.conversionWindowDays, 180)
	// v2.2: raised 50 → 1000 with the perk catalog — fraud stays priced out by
	// the real-subscription cost per +1; the daily spike alert is the tripwire.
	assert.equal(DEFAULT_REFERRAL_PARAMS.annualAutoRewardCap, 1000)
	// §4.1 ladder unit: claim N unlocks at N × unit; 0 closes the perk.
	assert.equal(DEFAULT_REFERRAL_PARAMS.permanentHandleUnit, 1000)
})

test('referral id prefix and the reserved /join route', () => {
	assert.match(makeId('ref'), /^ref_/)
	// /join must never be shadowed by a user handle (credits doc §11.1).
	assert.ok(isReservedHandle('join'))
})
