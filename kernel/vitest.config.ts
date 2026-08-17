import { defineConfig } from 'vitest/config'

/**
 * The kernel's tests are plain `node:assert` suites — vitest is here for the
 * TypeScript loading and nothing else. No environment, no pool, no setup files:
 * if a test in this package ever needs one of those, the thing it is testing has
 * stopped being part of the kernel.
 */
export default defineConfig({
	test: {
		include: ['test/**/*.test.mjs']
	}
})
