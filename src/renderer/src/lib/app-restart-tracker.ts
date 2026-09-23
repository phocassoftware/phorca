import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_APP_RESTART_STARTED_EVENT,
  ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT
} from '../../../shared/renderer-shutdown-events'

let intentionalAppRestartInProgress = false

/** True while a renderer-initiated restart (relaunch/restart/reload, or lazy-chunk recovery)
 *  is preparing or in flight, so a beforeunload/window-close guard knows not to veto it. */
export function isIntentionalAppRestartInProgress(): boolean {
  return intentionalAppRestartInProgress
}

export function registerAppRestartBeforeUnloadBypass(): () => void {
  const markInProgress = (): void => {
    intentionalAppRestartInProgress = true
  }
  const clearInProgress = (): void => {
    intentionalAppRestartInProgress = false
  }

  window.addEventListener(ORCA_APP_RESTART_STARTED_EVENT, markInProgress)
  window.addEventListener(ORCA_APP_RESTART_ABORTED_EVENT, clearInProgress)
  window.addEventListener(ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT, clearInProgress)

  return () => {
    window.removeEventListener(ORCA_APP_RESTART_STARTED_EVENT, markInProgress)
    window.removeEventListener(ORCA_APP_RESTART_ABORTED_EVENT, clearInProgress)
    window.removeEventListener(ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT, clearInProgress)
    // Why: hot reloads can re-register this listener inside the same renderer.
    // Reset the module flag on cleanup so a failed earlier restart attempt
    // cannot silently suppress future unsaved-change prompts.
    intentionalAppRestartInProgress = false
  }
}
