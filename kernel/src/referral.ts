import type { ReferralParams } from './types.js'

/** Bumped whenever DEFAULT_REFERRAL_PARAMS changes; drives cache invalidation. */
export const REFERRAL_PARAMS_VERSION = 5

/**
 * Defaults of the referral mechanism (credits doc §10.3): all numbers are
 * unvalidated hypotheses, adjustable at runtime via the `flags:referral` KV
 * override in alink-core. Already-scheduled rewards are never retroactively
 * changed by a parameter cut (credits doc §0 #5).
 */
export const DEFAULT_REFERRAL_PARAMS: ReferralParams = {
	rewardHoldDays: 14, // refund window + privacy blur (§3.4); never below daily-batch
	referrerPastDueGraceDays: 30, // aligned with the dunning ladder (§5.4)
	conversionWindowDays: 180,
	annualAutoRewardCap: 1000, // conversions/year auto-counted; beyond -> manual review (§3.3, raised 50→1000 with the perk catalog — fraud stays priced out by the real-subscription cost per +1; the daily spike alert is the remaining tripwire)
	introMonthlyLimit: 5, // signed referral links per issuer per month (entry plan D1, free 5 起步)
	permanentHandleUnit: 1000, // conversions per permanent-handle claim (§4 ladder); 0 = perk closed
	version: REFERRAL_PARAMS_VERSION
}
