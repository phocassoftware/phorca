import type { ChildProcess } from 'node:child_process'
import {
  QUIT_RENDERER_ACK_TIMEOUT_MS,
  WILL_QUIT_TEARDOWN_DEADLINE_MS
} from '../../shared/quit-teardown-deadline'
import { serveSignalExitError } from './serve-signal-exit-diagnostic'

export const SERVE_CHILD_FORCE_KILL_SCHEDULING_MARGIN_MS = 5_000
export const SERVE_CHILD_FORCE_KILL_GRACE_MS =
  QUIT_RENDERER_ACK_TIMEOUT_MS +
  WILL_QUIT_TEARDOWN_DEADLINE_MS +
  SERVE_CHILD_FORCE_KILL_SCHEDULING_MARGIN_MS

/**
 * Runs a foreground `orca serve` child to completion: forwards SIGINT/SIGTERM/SIGHUP
 * (skipped on Windows, where a console delivers Ctrl-C to both processes directly),
 * force-kills after a grace period if the child ignores the forwarded signal, and
 * resolves the child's own exit code or rejects a diagnostic error for an abnormal exit.
 */
export function superviseForegroundServe(child: ChildProcess): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>()
  const forwardsHangup = process.platform === 'linux'
  const forwardedSignals = new Set<NodeJS.Signals>()
  let forceKillTimer: NodeJS.Timeout | undefined
  const forwardSignal = (signal: NodeJS.Signals): void => {
    // A Windows console delivers Ctrl-C to parent and child; child.kill would terminate the child mid-teardown.
    if (process.platform !== 'win32') {
      forwardedSignals.add(signal)
      child.kill(signal)
    }
    forceKillTimer ??= setTimeout(() => child.kill('SIGKILL'), SERVE_CHILD_FORCE_KILL_GRACE_MS)
  }
  const cleanup = (): void => {
    process.off('SIGINT', forwardSignal)
    process.off('SIGTERM', forwardSignal)
    if (forwardsHangup) {
      process.off('SIGHUP', forwardSignal)
    }
    clearTimeout(forceKillTimer)
  }
  process.on('SIGINT', forwardSignal)
  process.on('SIGTERM', forwardSignal)
  if (forwardsHangup) {
    process.on('SIGHUP', forwardSignal)
  }
  const handleExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    cleanup()
    const signalWasForwarded = signal !== null && forwardedSignals.has(signal)
    if (typeof code === 'number' || signalWasForwarded) {
      resolve(code ?? 0)
      return
    }
    reject(serveSignalExitError(signal))
  }
  child.once('error', (error) => {
    cleanup()
    child.off('exit', handleExit)
    reject(error)
  })
  child.once('exit', handleExit)
  return promise
}
