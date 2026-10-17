// setup for vitest
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
// Registers jest-dom matchers (toBeInTheDocument, etc.) and augments Vitest's
// Assertion type with them - the /matchers subpath alone only provides the
// standalone function types, not the global expect() augmentation.
import '@testing-library/jest-dom/vitest'

// runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup()
})
