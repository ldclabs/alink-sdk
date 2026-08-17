export const D1_CORE_SCHEMA_VERSION = '0003_referrals'

// The control-plane D1 tables migrations 0001–0003 define. Everything user-domain
// (users, agents, relationships, requests, audit chain, …) has
// moved into the per-user UserDO's own SQLite (storage architecture §3.1/§10),
// the transactional outbox lives in each emitting user's UserDO (§10.5 O-1),
// monthly usage counters stream to Analytics Engine (§10.4 P1-1), event guest
// rosters live in per-event EventDOs (§10.4 P1-2), and the protocol-Provider
// registries (delegations, agent profiles, actor nonces) live in the global
// ProviderDO (§10.4 P2-5), so they are intentionally absent here. Later
// control-plane tables (auth_links, passkey_*, oauth_*, user_registry,
// active_subscriptions, events) live in migrations 0004+ and are not part of
// this list.
export const D1_CORE_TABLES = [
	'billing_events',
	'data_keys',
	'account_deletions',
	'referrals'
] as const

export type D1CoreTable = (typeof D1_CORE_TABLES)[number]
