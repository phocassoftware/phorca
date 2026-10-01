import { beforeEach, vi } from 'vitest'

// Existing Orca contracts exercise unmanaged builds; managed tests opt in explicitly.
vi.stubGlobal('PHORCA_MANAGED_BUILD', false)
beforeEach(() => vi.stubGlobal('PHORCA_MANAGED_BUILD', false))
