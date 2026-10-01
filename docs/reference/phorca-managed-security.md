# Phorca managed security controls

Tracking: [AI-101](https://helpphocassoftware.atlassian.net/browse/AI-101).
Assessment baseline: Rohan's [Tool Assessment Principles — Draft](https://helpphocassoftware.atlassian.net/wiki/spaces/PRC/pages/5816877156/Tool+Assessment+Principles+-+Draft), reviewed 30 September 2026.

This describes code enforcement and its limits. It does not certify that Phorca passes the assessment. Contracts, organization authentication, signed distribution and endpoint testing need evidence outside this change.

## Administrator policy

Managed Phorca builds use a machine policy independent of profile settings, environment variables, CLI arguments and repository files. Missing, unreadable, malformed or unsupported policy denies every optional capability. Unknown fields invalidate the whole document. Values must be actual booleans. The policy is read once per process; restart the desktop, daemon and remote host processes after changing it.

| Platform | Administrator-controlled source                                                  |
| -------- | -------------------------------------------------------------------------------- |
| Windows  | `HKLM\SOFTWARE\Policies\Phocas\Phorca`, `Policy` value, `REG_SZ` containing JSON |
| macOS    | `/Library/Application Support/Phocas/Phorca/policy.json`                         |
| Linux    | `/etc/phocas/phorca/policy.json`                                                 |

On macOS/Linux the file and every ancestor must be root-owned, not group/world-writable, and not a symlink. On Windows deploy with the normal machine-policy ACL: administrators/SYSTEM can write, ordinary users can only read. Never delegate write access to the policy key. There is no user-supplied policy path or environment override.

Use [the JSON schema](../../config/phorca-managed-policy.schema.json) and [restricted example](../../config/phorca-managed-policy.example.json) with Intune/MDM deployment tooling. They are configuration artifacts, not an ADMX template or a native Intune settings catalogue integration. Deploy the Windows value through a system-context registry policy/remediation; deploy the Unix file with administrator ownership and mode `0644` under `0755` directories. A minimal document is `{"version":1}`. Only administrators should opt capabilities in after review.

| Field                   | Enforcement when false                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowComputerUse`      | Refuse the native computer provider and sidecar before observation, input or permission requests; refuse emulator control/helper startup while preserving session cleanup.                                                                     |
| `allowAutomations`      | No scheduler startup/catch-up, manual scheduled runs, external schedule creation/resume/run, or background orchestration worker starts. Pausing/deleting external schedules remains available.                                                 |
| `allowNetworkListeners` | Keep the runtime WebSocket on loopback, regardless of saved paired devices or serve defaults; refuse pairing-time widening and non-loopback transport creation.                                                                                |
| `allowCloudServices`    | Disable Orca hosted login configuration, relay connections, push setup, diagnostic upload endpoints/uploads, artifact/skill sharing preferences and cloud skill-package downloads.                                                             |
| `allowTelemetry`        | Do not initialize or send PostHog usage telemetry, even with official-build credentials and saved opt-in.                                                                                                                                      |
| `allowRuntimeDownloads` | Refuse speech-model pulls, missing scrcpy server downloads, skill-package pulls, plugin/marketplace Git pulls, remote update download/install and SSH native-package installation. Cached scrcpy and verified SSH native caches remain usable. |
| `allowPlugins`          | Refuse plugin installation and runtime activation, commands, event delivery and content-pack enablement even with saved consent or user enablement.                                                                                            |

The policy controls optional Orca cloud services, not the Claude/OpenAI services used by the approved agent CLIs. It is not a general network firewall. Source checkout/fetch, browser/file downloads, MCP tools and arbitrary terminal commands still need endpoint/network controls.

Local IPC and loopback listeners used by agent hooks and the local web client remain necessary for normal operation. This change prevents LAN exposure; it does not remove every inbound listener. Existing schedules already installed in an external agent's scheduler must be paused/deleted there; blocking future Phorca requests does not cancel work outside Phorca.

## Claude and Codex approval parity

Managed launches support Claude and Codex. Both terminal and structured launches override stored Yolo preferences. Claude receives explicit `default` permission mode; Codex receives `on-request` approval and `workspace-write` sandbox settings. New and resumed sessions use the same policy. Claude's live/restored permission-mode changes cannot switch away from `default`.

Managed terminal launches ignore command overrides and free-form arguments, use owned approval arguments, and discard user launch-environment overlays. Restored command strings cannot replay old bypass flags. Model/effort choices still use the existing typed session-option path. Settings writers reject changes to managed arguments, environment and commands; readers/notifications show effective policy. Other agent launchers are unavailable because their approval contracts are not covered by this change. API-key-based OpenAI dictation is disabled; local speech remains available with pre-provisioned models.

These are Phorca-mediated launch controls. A user who can run a shell can invoke a CLI directly, change its configuration or use the CLI's own interactive commands. Apply vendor enterprise approval policies and managed account restrictions as well. This change neither verifies Phocas organization membership nor prevents personal credentials in an installed CLI's own credential store.

## Versions, distribution and remote hosts

The existing Phorca desktop disables automatic self-update. Keep distributing an approved version through company device management. Runtime-download denial also prevents the remote update path and cold SSH native-package installs. Provision compatible SSH dependencies before rollout; a cold host can fail to connect under the restricted policy.

Policy is enforced by the process performing the operation. Install the policy on SSH execution hosts too. New clients apply their own guards before forwarding covered operations, but an old/unmanaged host is not proven compliant by a new client. No new wire opcodes or required RPC fields are introduced; diagnostic bundle policy metadata is additive. Folder workspaces follow the same launch controls as Git worktrees.

The upstream release workflows reference Stably infrastructure and signing credentials. This PR does not create a Phocas signing identity, publish a release or prove signature verification. Do not use unsigned developer-channel installers as assessment evidence. Establish company-owned signed Windows/macOS artifacts, signed/checksummed Linux distribution and a controlled delivery channel before claiming the distribution requirement.

## Local audit and endpoint inventory

Managed unary runtime RPC actions add a `phorca.rpc.action` record to the existing local NDJSON trace sink: method, client kind, success/failure, timestamp, duration and trace IDs. Arguments, prompts, auth tokens and error contents are omitted. Diagnostic bundle headers include the effective policy. Existing diagnostic preview/export keeps these records parseable and local; cloud upload is blocked by default.

This is best-effort diagnostic evidence with existing rotation/retention and diagnostics opt-out. It is not an immutable compliance audit, does not identify a corporate actor, and does not cover every desktop IPC, streaming operation or tool action inside a CLI. Export through existing diagnostics or collect the trace files with approved endpoint tooling; retention/collection is an IT responsibility.

| Destination                                                    | Purpose and control                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `login.onorca.dev`, `relay.onorca.dev`, `push.onorca.dev`      | Optional Orca login, mobile relay and push; denied by cloud-service policy.                            |
| Diagnostic token endpoint configured by the build              | Optional support upload; unavailable under cloud-service denial, including runtime endpoint overrides. |
| `us.i.posthog.com`                                             | Usage telemetry; denied by telemetry policy.                                                           |
| `huggingface.co` and its file delivery redirects               | Local speech model downloads; denied by runtime-download policy.                                       |
| GitHub's Genymobile/scrcpy release assets                      | Missing Android scrcpy server; denied by runtime-download policy.                                      |
| Registered plugin/marketplace Git remotes                      | Extension download/preview; require both plugin and runtime-download permission.                       |
| Cloud skill grants and their signed package URLs               | Skill downloads; require cloud-service and runtime-download permission.                                |
| SSH host's configured npm registry and Node header sources     | Cold native dependency install; denied by runtime-download policy.                                     |
| Agent-provider, Git-provider and user-configured MCP endpoints | Task execution; outside the optional-cloud switch, requiring company/provider controls.                |

This inventory covers the paths changed here, not every network destination in Orca. Code does not request EDR exemptions. Keep Intune/Defender/CrowdStrike active and obtain endpoint test results; disabling native computer use reduces capability exposure but does not prove EDR acceptance.

## Assessment disposition

| Main principle                    | What this change contributes                                                                                                           | Evidence still needed                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. DPA                            | Optional vendor cloud sharing/upload defaults off.                                                                                     | Applicable DPAs, subprocessors and data-flow review.                                             |
| 2. No training                    | Reduce optional data export; no new prompt/content telemetry.                                                                          | Claude/OpenAI and any enabled service's contractual/tenant training settings.                    |
| 3. Phocas identity only           | Restrict managed launchers to Claude/Codex; remove launch-env/command overrides and API-key dictation.                                 | Vendor-enforced company accounts, no personal accounts/keys/subscriptions; this is still a gap.  |
| 4. No endpoint exemptions         | No exemption mechanisms added; computer control defaults off.                                                                          | Real managed-device EDR validation on supported platforms.                                       |
| 5. Enforceable risky capabilities | Administrator-owned deny-by-default capability policy at execution boundaries.                                                         | Review remaining loopback/IPC, browser and external/manual shell surfaces; managed-host rollout. |
| 6. Centrally disable Yolo         | Explicit managed approval mode for both providers, new/resumed terminals and structured sessions, including live Claude option writes. | Vendor-side policy for commands and modes selected within a CLI or launched outside Phorca.      |
| 7. Signed release channel         | Preserve managed distribution; document unsigned-channel exclusion.                                                                    | Company-owned signing/notarization, artifact verification and delivery evidence.                 |
| 8. Company chooses version        | Preserve desktop self-update denial; deny remote/runtime downloads by default.                                                         | IT-owned version deployment/pinning and remote dependency provisioning.                          |
| 9. Necessary capability gap       | Retain local workspace/worktree, SSH, terminal and agent-session coordination; optional background work can be approved by policy.     | A demonstrated business use case and comparison with approved Claude/Codex workflows.            |

Preference improvements: an MDM-deployable schema, parseable local action records, explicit optional-cloud/telemetry controls, disabled unreviewed plugin execution, and documented endpoints. SSO/SCIM, certifications, immutable audit/retention, a reviewed MCP catalogue and a company security/disclosure owner remain external or separate product work. Central-registry runtime delivery remains roadmap work: this PR supplies a deny switch, not a replacement registry.
