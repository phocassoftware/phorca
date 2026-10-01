import type { EmulatorBackend, EmulatorDevice } from './backends/emulator-backend'

export async function resolveEmulatorDeviceBackend(
  backends: EmulatorBackend[],
  device: string,
  fallback: EmulatorBackend
): Promise<EmulatorBackend> {
  for (const backend of backends) {
    if (await backend.ownsDevice(device)) {
      return backend
    }
  }
  return backends.find((backend) => backend.isSupportedOnHost()) ?? fallback
}

export async function listAvailableEmulatorDevices(
  backends: EmulatorBackend[]
): Promise<EmulatorDevice[]> {
  const perBackend = await Promise.all(
    backends.map(async (backend) => {
      if (!backend.isSupportedOnHost()) {
        return []
      }
      try {
        return await backend.listDevices()
      } catch {
        return []
      }
    })
  )
  return perBackend.flat()
}
