export const ORCA_SYNC_BRANCH = 'codex/AI-101-orca-release-sync'
const UPSTREAM = { owner: 'stablyai', repo: 'orca' }
const RELEASE_REF = 'refs/remotes/orca-sync/release'
const MINIMUM_AGE_MS = 72 * 60 * 60 * 1000
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const BODY_START = '<!-- orca-sync:start -->'
const BODY_END = '<!-- orca-sync:end -->'

function compareVersions(left, right) {
  return left.map((part, index) => part - right[index]).find((part) => part !== 0) ?? 0
}

function stableVersion(release) {
  const match = STABLE_TAG.exec(release.tag_name)
  if (!match || release.draft || release.prerelease || !release.published_at) {
    return null
  }
  const version = match.slice(1).map(Number)
  return version.every(Number.isSafeInteger) && Number.isFinite(Date.parse(release.published_at))
    ? version
    : null
}

export function selectOrcaRelease(releases, { now = Date.now(), overrideTag = '' } = {}) {
  if (overrideTag) {
    if (!STABLE_TAG.test(overrideTag)) {
      throw new Error('Override must be a stable desktop tag: vX.Y.Z.')
    }
    const release = releases.find((candidate) => candidate.tag_name === overrideTag)
    if (!release || !stableVersion(release)) {
      throw new Error(`No published stable desktop release exists for ${overrideTag}.`)
    }
    return release
  }

  let selected = null
  let selectedVersion = null
  for (const release of releases) {
    const version = stableVersion(release)
    if (!version || Date.parse(release.published_at) > now - MINIMUM_AGE_MS) {
      continue
    }
    const difference = selectedVersion ? compareVersions(version, selectedVersion) : 1
    if (difference > 0) {
      selected = release
      selectedVersion = version
    }
  }
  return selected
}

function releaseDescription(release, overrideTag) {
  const link = `https://github.com/stablyai/orca/releases/tag/${release.tag_name}`
  return `${BODY_START}
## ELI5

Bring Phorca up to [Orca ${release.tag_name}](${link}), keeping Phorca's changes when merged.

## What Changed

The update branch now includes this Orca release, published ${release.published_at}.
${overrideTag ? 'A maintainer selected this release manually, bypassing the 72-hour wait.' : 'This is the highest stable desktop version published at least 72 hours before the check.'}
Phorca's workflow files are retained. Review [Orca's workflow changes](https://github.com/stablyai/orca/tree/${release.tag_name}/.github/workflows) manually.

## Why

One continuing PR keeps upstream updates reviewable without a separate PR for every release.
Merge with **Create a merge commit** to retain the Orca history needed by later checks.
Resolve any conflicts on this branch; later updates preserve those commits.

## Linked Issue

[AI-101](https://helpphocassoftware.atlassian.net/browse/AI-101)
${BODY_END}

## Visual Proof

Maintainers: attach evidence for any upstream UI changes before merging.

## Testing

- [ ] PR checks pass
- [ ] Phorca managed security controls and both Codex and Claude behavior checked
- [ ] Upstream changes reviewed on relevant platforms, including SSH and folder workspaces

## AI Disclosure

Created by the Orca release sync workflow; no AI model runs in this workflow.

## Review

Maintainer review required; this workflow never merges a PR.

## Agent skill upstream boundary

- [ ] Review upstream changes against docs/reference/agent-skill-sharing-upstream-boundary.md

## Notes

Set the repository variable ORCA_SYNC_PAUSED=true to pause scheduled updates.
Closing this PR also pauses updates until a manual workflow run.

## Checklist

- [ ] Upstream changes and Phorca customizations reviewed
- [ ] Conflicts resolved and checks completed before merging
`
}

function updatedDescription(previous, next) {
  const start = previous?.indexOf(BODY_START) ?? -1
  const end = previous?.indexOf(BODY_END, start) ?? -1
  if (start < 0 || end < 0) {
    return previous ?? next
  }
  const nextEnd = next.indexOf(BODY_END) + BODY_END.length
  return previous.slice(0, start) + next.slice(0, nextEnd) + previous.slice(end + BODY_END.length)
}

export async function syncOrcaRelease({
  github,
  git,
  repo,
  base,
  manual = false,
  overrideTag = '',
  now = Date.now()
}) {
  const runGit = async (args, allowedCodes = [0]) => {
    const result = await git(args)
    if (!allowedCodes.includes(result.exitCode)) {
      throw new Error(
        `git ${args[0]} failed (${result.exitCode}): ${result.stderr || result.stdout}`
      )
    }
    return result
  }
  const ancestor = async (older, newer) =>
    (await runGit(['merge-base', '--is-ancestor', older, newer], [0, 1])).exitCode === 0
  const restoreWorkflows = async (source) => {
    await runGit(['rm', '-r', '-f', '--ignore-unmatch', '--', '.github/workflows'])
    if (
      (await runGit(['ls-tree', '--name-only', source, '--', '.github/workflows'])).stdout.trim()
    ) {
      await runGit([
        'restore',
        '--source',
        source,
        '--staged',
        '--worktree',
        '--',
        '.github/workflows'
      ])
    }
  }

  const pulls = await github.paginate(github.rest.pulls.list, {
    ...repo,
    head: `${repo.owner}:${ORCA_SYNC_BRANCH}`,
    state: 'all',
    sort: 'created',
    direction: 'desc',
    per_page: 100
  })
  const openPulls = pulls.filter((pull) => pull.state === 'open')
  if (openPulls.length > 1) {
    throw new Error('More than one Orca sync PR is open; close the duplicates.')
  }
  const pull = openPulls[0] ?? pulls[0]
  if (!manual && pull?.state === 'closed' && !pull.merged_at) {
    return `Updates paused because ${pull.html_url} was closed without merging. Run manually to resume.`
  }

  const releases = overrideTag
    ? [(await github.rest.repos.getReleaseByTag({ ...UPSTREAM, tag: overrideTag })).data]
    : await github.paginate(github.rest.repos.listReleases, { ...UPSTREAM, per_page: 100 })
  const release = selectOrcaRelease(releases, { now, overrideTag })
  if (!release) {
    return 'No stable desktop Orca release is at least 72 hours old.'
  }

  if ((await runGit(['status', '--porcelain'])).stdout.trim()) {
    throw new Error('Orca sync requires a clean, disposable workflow checkout.')
  }
  await runGit([
    'fetch',
    '--no-tags',
    'https://github.com/stablyai/orca.git',
    `+refs/tags/${release.tag_name}:${RELEASE_REF}`
  ])
  const releaseSha = (await runGit(['rev-parse', `${RELEASE_REF}^{commit}`])).stdout.trim()
  const baseRef = `refs/remotes/origin/${base}`
  if (await ancestor(releaseSha, baseRef)) {
    return `Phorca already includes Orca ${release.tag_name}.`
  }

  const remoteRef = `refs/heads/${ORCA_SYNC_BRANCH}`
  const remote = await runGit(['ls-remote', '--exit-code', '--heads', 'origin', remoteRef], [0, 2])
  const expectedHead = remote.stdout.trim().split(/\s+/)[0] ?? ''
  let preserveBranch = false
  if (expectedHead) {
    await runGit(['fetch', '--no-tags', 'origin', `${remoteRef}:refs/remotes/orca-sync/previous`])
    // Only retire a branch whose entire history is already safely in Phorca.
    preserveBranch = !(await ancestor(expectedHead, baseRef))
  }

  await runGit(['config', 'user.name', 'github-actions[bot]'])
  await runGit(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
  let changed = true
  if (preserveBranch) {
    await runGit(['checkout', '-B', ORCA_SYNC_BRANCH, expectedHead])
    changed = !(await ancestor(releaseSha, 'HEAD'))
    if (changed) {
      await runGit(['merge', '--no-commit', '--no-ff', releaseSha], [0, 1])
      await restoreWorkflows(baseRef)
      const conflicts = (await runGit(['diff', '--name-only', '--diff-filter=U'])).stdout.trim()
      if (conflicts) {
        await runGit(['merge', '--abort'])
        throw new Error(
          `Orca ${release.tag_name} conflicts with the update branch. Resolve manually; the remote branch was preserved.\n${conflicts}`
        )
      }
      await runGit(['rev-parse', '--verify', 'MERGE_HEAD'])
      await runGit(['commit', '-m', `AI-101 Merge Orca ${release.tag_name}; keep Phorca workflows`])
    }
  } else {
    // Starting at the upstream tag exposes conflicts in the PR without discarding fork changes.
    await runGit(['checkout', '-B', ORCA_SYNC_BRANCH, releaseSha])
  }

  // GITHUB_TOKEN cannot push a tip whose workflow files differ from Phorca's default branch.
  await restoreWorkflows(baseRef)
  const workflowChanges = (await runGit(['diff', '--cached', '--quiet'], [0, 1])).exitCode !== 0
  if (workflowChanges) {
    await runGit(['commit', '-m', 'AI-101 Keep Phorca workflow files during Orca sync'])
  }
  if (changed || workflowChanges) {
    await runGit(['diff', '--quiet', baseRef, 'HEAD', '--', '.github/workflows'])
    await runGit([
      'push',
      `--force-with-lease=${remoteRef}:${expectedHead}`,
      'origin',
      `HEAD:${remoteRef}`
    ])
  }

  const description = releaseDescription(release, overrideTag)
  const title = `AI-101 Update Phorca to Orca ${release.tag_name}`
  if (pull && !pull.merged_at) {
    const generatedBody = pull.body?.split(BODY_START)[1]?.split(BODY_END)[0] ?? ''
    const describedTag = /\[Orca (v\d+\.\d+\.\d+)\]/.exec(generatedBody)?.[1] ?? ''
    const describedVersion = STABLE_TAG.exec(describedTag)?.slice(1).map(Number)
    // A manually selected younger release must not be relabelled as an older automatic candidate.
    const refreshRelease =
      changed || !describedVersion || compareVersions(stableVersion(release), describedVersion) >= 0
    const desiredTitle = refreshRelease ? title : pull.title
    const desiredBody = refreshRelease ? updatedDescription(pull.body, description) : pull.body
    const needsUpdate =
      pull.state === 'closed' ||
      (pull.base?.ref ?? base) !== base ||
      pull.title !== desiredTitle ||
      pull.body !== desiredBody
    if (needsUpdate) {
      await github.rest.pulls.update({
        ...repo,
        pull_number: pull.number,
        state: 'open',
        base,
        title: desiredTitle,
        body: desiredBody
      })
    }
    return `${changed || needsUpdate ? 'Updated' : 'Kept'} ${pull.html_url}; the branch includes Orca ${release.tag_name}.`
  }
  const created = await github.rest.pulls.create({
    ...repo,
    head: ORCA_SYNC_BRANCH,
    base,
    title,
    body: description,
    maintainer_can_modify: true
  })
  return `Created ${created.data.html_url} for Orca ${release.tag_name}.`
}
