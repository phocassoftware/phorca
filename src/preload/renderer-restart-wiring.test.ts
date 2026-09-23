import { describe, expect, it, vi } from 'vitest'
import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_RENDERER_UNLOAD_PREVENTED_EVENT
} from '../shared/renderer-shutdown-events'
import { registerRendererRestartIpcRelays } from './renderer-restart-wiring'

describe('renderer restart wiring', () => {
  it('relays a prevented unload as both the unload and restart-aborted events', () => {
    const eventTarget = new EventTarget()
    const unloadPrevented = vi.fn()
    const restartAborted = vi.fn()
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const ipcRenderer = {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
        return ipcRenderer
      })
    } as unknown as Parameters<typeof registerRendererRestartIpcRelays>[0]
    eventTarget.addEventListener(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, unloadPrevented)
    eventTarget.addEventListener(ORCA_APP_RESTART_ABORTED_EVENT, restartAborted)

    registerRendererRestartIpcRelays(ipcRenderer, eventTarget)
    listeners.get('window:unload-prevented')?.({})

    expect(ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(unloadPrevented).toHaveBeenCalledTimes(1)
    expect(restartAborted).toHaveBeenCalledTimes(1)
  })
})
