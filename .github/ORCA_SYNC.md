# Syncing Orca into Phorca

**Sync Orca release** runs daily at 00:23 UTC. It selects the
highest stable desktop release (`vX.Y.Z`) from `stablyai/orca` published at
least 72 hours earlier. Drafts, prereleases and mobile versions are excluded.
GitHub may delay scheduled runs.

The workflow maintains one open PR into Phorca's default branch (`main`), using
`codex/AI-101-orca-release-sync`. Review and merge it yourself. It brings in
Orca source changes, preserving Phorca customizations through a normal merge.
It keeps `.github/workflows/` exactly as they are in Phorca's default branch;
review Orca's workflow updates manually. The generated PR links to those files.
The workflow does not run AI or treat Codex and Claude differently.

## Enable it

1. Merge this workflow and its script into Phorca's default branch.
2. In **Settings → Actions → General → Workflow permissions**, enable
   **Allow GitHub Actions to create and approve pull requests**. Organization
   policy must allow this setting. The workflow itself grants `contents: write`
   and `pull-requests: write` to GitHub's automatically provided `GITHUB_TOKEN`.
3. Enable the workflow in Actions and run it once manually from the default branch.

No custom token or repository secret is needed. When the PR shows
**Approve workflows to run**, approve its checks before merging. See
[GitHub's token documentation](https://docs.github.com/en/actions/concepts/security/github_token)
and [PR creation settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests).
The sync job executes only the script from Phorca's default branch, disables
Git hooks, and does not install dependencies or execute upstream code.

## Use it

- **Merge with “Create a merge commit.”** Squash/rebase loses the Orca history
  needed to recognize versions already included in Phorca. Enable merge commits
  in the repository settings if necessary. After merging, the next update gets a
  new PR on the same branch; there is only one open sync PR at a time.
- Set repository variable **ORCA_SYNC_PAUSED=true** to pause scheduled updates.
  Remove it or set it to `false` to resume. Manual runs remain available.
- Use **Run workflow** with an optional stable release tag to bypass the
  72-hour wait. A release older than the PR's selected version is not merged,
  even from a divergent upstream branch. Workflow files can still be refreshed.
  A version already in Phorca or the update branch is a no-op.
  Always select Phorca's default branch in **Use workflow from**; other branches
  and tags are rejected. The release is chosen with the separate `tag` input.
- Closing an unmerged sync PR pauses updates until a manual run reopens it.
- Resolve conflicts and push fixes on the PR branch. Those commits survive
  subsequent updates. If a later update conflicts, the workflow reports failure
  and preserves the remote branch. Resolve it manually and retry.
- Reviewed workflow changes on the pending PR pause further sync updates until
  that PR is merged, so a scheduled run cannot overwrite its CI fixes.
- Review and apply workflow edits separately to Phorca's default branch. The
  next sync refreshes the PR's workflow files from that branch, even if no new
  Orca release is eligible. Upstream workflow additions, edits and deletions are
  all excluded, and conflicts confined to those files do not block updates.

The first PR can show merge conflicts with Phorca. Review them and the usual
PR checks before merging, including Phorca's security controls and both agent
integrations. Updates use force-with-lease so a concurrent human push cannot be
overwritten. No automatic merge is performed.
If pushing an update succeeds but updating its PR details fails, rerun the
failed workflow with the same inputs. It repairs the title and release
description without another push.
