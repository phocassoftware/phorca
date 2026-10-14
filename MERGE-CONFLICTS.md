# Merging Orca into Phorca

Keep Phorca as close to upstream Orca as possible. When resolving a conflict, prefer
Orca's version and reapply only the smallest changes required for the two exceptions
below. Existing Phorca customizations do not automatically take priority.

## The only reasons to override Orca

1. **Preserve the Phorca name.** Keep the Orca-to-Phorca rename consistent in
   user-facing product names, branding, and any packaging metadata required by the
   rename. Update directly affected references and tests together. Keep upstream
   technical identifiers, CLI commands, environment variables, storage paths, and
   wire formats unless changing them is necessary for the rename to work. Avoid
   repository-wide search-and-replace; upstream links and attribution may still
   correctly refer to Orca.
2. **Keep CI green.** Make the smallest code, test, dependency, or workflow changes
   needed for the merged product to pass Phorca's required checks. Fix the cause of
   failures; do not disable checks, weaken assertions, or hide failures. Follow
   upstream workflow improvements, retaining only the fork-specific configuration
   needed to run CI in Phorca.

## Resolving conflicts

- Resolve individual conflicting sections, preserving upstream fixes and features.
  Avoid blanket choices of an entire side or file when a smaller edit works.
- Accept upstream behavior for everything outside the two exceptions. Do not add
  refactors, cleanup, new features, or unrelated customizations while resolving a merge.
- Apply this policy equally to Codex and Claude, keeping their behavior aligned.
- Keep any Phorca override easy to review: it must be explainable as either naming
  or CI, and use the smallest practical diff.

## Before merging

- Verify the Phorca name in the affected UI, documentation, and build artifacts;
  check that retained Orca references are intentional and compatible.
- Run the relevant typechecks, tests, lint, and build checks using the repository's
  existing commands and workflows. Follow [AGENTS.md](./AGENTS.md), including
  background launch requirements for tests and apps.
- Require passing CI on the final resolved revision. Local checks alone do not
  establish that CI is green.
- Review the changes against upstream: each retained override must serve one of
  the two exceptions above.
