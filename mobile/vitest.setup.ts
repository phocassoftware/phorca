import { beforeEach, vi } from 'vitest'

// Upstream mobile contracts use unmanaged builds; managed tests opt in explicitly.
vi.stubGlobal('PHORCA_MANAGED_BUILD', false)
beforeEach(() => vi.stubGlobal('PHORCA_MANAGED_BUILD', false))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
