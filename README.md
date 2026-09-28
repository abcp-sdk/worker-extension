# worker-extension

A standalone abc-protocol **extension server** that, against the **same**
config-registered set of remote
[**easyworker**](https://github.com/easylab-platform/easyworker) sandboxes:

- runs commands and reads / writes files (`worker-*` tools), and
- drives a **native GUI** through the platform accessibility tree
  (`computer-*` tools) via `xa11y` (Linux/Windows/macOS) or `adb` (Android).

There is **one** `sandboxes` config (a JSON list of `{name,url,token}`); every
tool takes an optional `sandbox` argument selecting one by name (the first is
the default). No sandbox lifecycle, no git, no external manager.

This repo is the merge of the former `worker-extension` and
`computer-use-extension`: they always addressed the same agent-workers, so the
duplicate discovery tool was collapsed into one `list-sandboxes` and the two
tool families now share a single config.

## worker-extension vs workspace-extension

They are alternatives — pick one:

| | `worker-extension` (this) | [`workspace-extension`](../workspace-extension) |
|---|---|---|
| Sandboxes | **config-registered** (`sandboxes` list) | **created on demand** via the worker-manager |
| Sandbox lifecycle | — | `sandbox-create` / `sandbox-list` / `sandbox-status` / `sandbox-delete` |
| Git (Forgejo) backend | — | `repo-*` tools |
| Checkout / port bridge | — | `sandbox-checkout` / `sandbox-port` |
| GUI computer-use | yes (`computer-*`) | — |
| Use when | you have a fixed set of workers (code + GUI) | you need many workspaces, separating durable files (git) from scratch files (sandbox) |

## Design

- **Own process, own repo.** The agent discovers it over `abc.discover` plus an
  `abc-presence` heartbeat; no agent/easylab code change is required.
- **One sandbox list, two tool families.** `sandboxes` is a JSON list of
  `{name,url,token}`; the `worker-*` (exec/files) and `computer-*` (GUI) tools
  all address these same sandboxes. Every tool declares `sandboxes` as
  `required_config`, so the agent **hard-disables** every tool until at least
  one is configured.
- **Capability discovery.** `list-sandboxes` probes each sandbox and reports
  `name<TAB>os<TAB>a11y=yes|no`. `worker-*` tools run on every sandbox; the
  `computer-*` tools require `a11y=yes` (the accessibility CLI is installed).
  A call to a sandbox without a11y fails with an actionable `a11yMissing`.
- **Direct worker.v1 RPC** (`WorkerService`), h1, bearer-authenticated. The
  generated descriptors are vendored under `src/gen/worker/v1/`, so this repo
  depends only on `@abc-protocol/sdk` + Connect/Buf.
- **Files route through the agent.** `upload`/`download`/`computer-screenshot`
  use the agent file RPCs; the **agent derives the MIME**. `read` never ingests:
  binary content is rejected, text is windowed with line numbers.
- **Localized end to end.** Tool/config descriptions carry an English
  `description` + a `descriptions.zh` map (resolved agent-side). Runtime text is
  localized through a typed catalog (`src/i18n.ts`) using the agent-projected
  session locale (`vars.agent.locale`). Failures use `TypedToolError` so the
  agent receives a real code (`invalid_argument` / `not_found` / `retryable` /
  `permission_denied`).

## Tools

Every tool takes the calling tenant/session implicitly (the protocol envelope)
and resolves its sandbox from `sandboxes` at call time.

**Jobs** (`worker-*`)

| Tool | Worker RPC | Notes |
|---|---|---|
| `info` | `Info` | os/arch/shell/workspace/home/boot_id |
| `exec` | `Execute` + `JobWait` loops + `JobOutput` | short tasks; waits ≤ `timeout` s (default 5, max 60). Always returns `job-id`; on completion up to 1000 lines, on timeout the **oldest 200** lines + "still running" |
| `job-start` | `Execute` | fire-and-forget long task; returns `job-id` only |
| `job-output` | `JobOutput` | `offset` (negative = from end) + `limit` (default 200, max 1000), `stream`; display capped at 1000 lines / 120 KiB |
| `job-wait` | `JobWait` loops | waits ≤ `timeout` s (default 60, max 600); returns the latest 200 lines |
| `job-kill` | `JobKill` | process-tree kill |
| `job-stdin` | `JobStdin` | write/close a job's stdin |
| `job-list` | `ListJobs` | id/state/exit/command |

**Files** (`worker-*`)

| Tool | Notes |
|---|---|
| `read` | text-only, `offset`/`limit` (default 200, max 1000), **line-numbered**, truncation marker; binary → error. Records the displayed lines as "seen" |
| `write` | overwrite with full content; rejected over 120 KiB; returns the numbered **whole** file; marks the whole file as "seen" |
| `edit` | 1-based line edit; `end-line < start-line` inserts, else replaces `[start-line, end-line]`; out-of-range clamps; returns a summary + unified diff. Enforces **read-before-edit** |
| `list` | breadth-first tree levels 1..`depth` (default 3), `limit` default 200 / max 1000 |
| `delete` / `move` / `copy` | path operations |
| `download` | agent `file:<code>` → workspace path |
| `upload` | workspace path → agent `file:<code>` (agent derives the MIME) |

**GUI computer-use** (`computer-*`; require `a11y=yes`)

| Tool | Notes |
|---|---|
| `computer-apps` | running apps whose a11y tree is visible (focused marked); Android = foreground package/activity |
| `computer-snapshot` | a11y tree of an app (or whole desktop); preferred over screenshot for deciding where to act; each element gets a stable `ref` |
| `computer-find` | match a CSS-like a11y selector; optional `center`/`bounds` output |
| `computer-action` | a11y action on a `ref`/selector (press/focus/toggle/select/expand/collapse/set-value/type-text/…) |
| `computer-click` / `computer-scroll` / `computer-drag` | coordinate input (fallback for canvas/unknown widgets) |
| `computer-type` / `computer-key` | keyboard input |
| `computer-screenshot` | PNG → `file:<code>` (use to see rendering, not to locate elements) |

**Discovery**

| Tool | Notes |
|---|---|
| `list-sandboxes` | one line per sandbox: `name<TAB>os<TAB>a11y=yes|no`; `data.sandboxes:[{name,os,platform,a11y}]` |

## Read-before-edit

`edit` is guarded so a session can only change what it has actually seen:

- **Seen required.** A file must have been `read` (or `write`n) in this session
  before it can be `edit`ed — otherwise `permission_denied`.
- **Range-limited.** Only the line ranges the session has seen may be edited.
- **Freshness.** If the file changed since that read, the edit is refused with
  `retryable`.
- **Invalidate on edit.** A successful edit clears the file's seen state.

State is one KV entry per `(tenant, session)` in the `worker-edit-state` bucket,
keyed `t.<tenant>.<sessionToken>`.

## Configuration

| Config | Meaning |
|---|---|
| `sandboxes` | JSON list of `{"name":"...","url":"http://worker:80","token":"..."}`. The first entry is the default; `computer-*` tools require that entry to have the accessibility CLI. |

## Build

```bash
npm install
npm run build          # tsc declarations + esbuild -> dist/main.js
npm run check          # tsc --noEmit
npm test               # vitest (needs nats-server on PATH or ABC_NATS_SERVER_BIN)
./build-image.sh       # buildkitd -> forgejo OCI
```

## Serve

```bash
NATS_URL=nats://nats:4222 node dist/main.js
```

Probes: `GET /api/v1/health`.

## Live end-to-end test

`tests/e2e.live.test.ts` drives the extension against a **real** easyworker over
a **real** NATS broker (skipped unless the env vars below are set):

```bash
LIVE_NATS_URL=nats://<nats>:4222 \
WORKER_URL=http://<easyworker> \
WORKER_TOKEN=<bearer> \
npx vitest run tests/e2e.live.test.ts
```
