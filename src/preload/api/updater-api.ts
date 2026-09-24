export type UpdaterApi = {
  /** Preserved for non-update consumers that display the running app version. */
  getVersion: () => Promise<string>
  /** Opens the public Phorca Releases page in the system browser. */
  openReleasesPage: () => Promise<void>
}
