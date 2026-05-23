import '@testing-library/jest-dom'
// [TEST-2] Explicit @testing-library/react cleanup after each test so DOM
// nodes mounted via `render()` are unmounted between cases. Modern
// @testing-library auto-cleanups when `globals: true` în vitest config, but
// being explicit is best-practice (avoids silent regression dacă
// auto-cleanup ever disabled OR config drifts).
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
afterEach(() => { cleanup() })
