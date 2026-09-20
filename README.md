# worker-extension

A standalone abc-protocol **extension server** that runs commands and reads /
writes files in **ONE fixed** remote
[**easyworker**](https://github.com/easylab-platform/easyworker) sandbox,
addressed purely by two config knobs (`worker-url` + `worker-token`).

This is the **stable single-worker** variant. It is deliberately minimal: no
sandbox lifecycle, no git, no external manager.

## worker-extension vs workspace-extension

They are alternatives — pick one:

| | `worker-extension` (this) | [`workspace-extension`](../workspace-extension) |
|---|---|---|
| Worker | **one fixed** worker (`worker-url`/`worker-token`) | **many**, created on demand via the worker-manager |
| Sandbox lifecycle | — | `sandbox-create` / `sandbox-list` / `sandbox-status` / `sandbox-delete` |
| Git (Forgejo) backend | — | `repo-*` tools |
| Checkout / port bridge | — | `sandbox-checkout` / `sandbox-port` |
| Tool names | unprefixed (`read`, `write`, `exec`, …) | prefixed (`sandbox-read`, `sandbox-exec`, …) |
| Use when | you just need one stable worker | you need many workspaces, separating durable files (git) from scratch files (sandbox) |

## Design

- **Own process, own repo.** The agent discovers it over `abc.discover` plus an
  `abc-presence` heartbeat; no agent/easylab code change is required.
- **One worker, by config.** `worker-url` + `worker-token`; every tool declares
  both as `required_config`, so the agent **hard-disables** a tool until the
  worker is configured.
- **Direct worker.v1 RPC** (`WorkerService`), h1, bearer-authenticated. The
  generated descriptors are vendored under `src/gen/worker/v1/`, so this repo
  depends only on `@abc-protocol/sdk` + Connect/Buf.
- **Files route through the agent.** `upload`/`download` use the agent file
  RPCs; the **agent derives the MIME**. `read` never ingests: binary content is
  rejected, text is windowed with line numbers.
- **Localized end to end.** Tool/config descriptions carry an English
  `description` + a `descriptions.zh` map (resolved agent-side). Runtime text is
  localized through a typed catalog (`src/i18n.ts`) using the agent-projected
  session locale (`vars.agent.locale`). Failures use `TypedToolError` so the
  agent receives a real code (`invalid_argument` / `not_found` / `retryable` /
  `permission_denied`).

## Tools

Every tool takes the calling tenant/session implicitly (the protocol envelope)
and resolves `worker-url`/`worker-token` at call time.

**Jobs**

| Tool | Worker RPC | Notes |
|---|---|---|
| `info` | `Info` | os/arch/shell/workspace/boot_id |
| `exec` | `Execute` + `JobWait` loops + `JobOutput` | short tasks; waits ≤ `timeout` s (default 5, max 60). Always returns `job-id`; on completion up to 1000 lines, on timeout the **oldest 200** lines + "still running" |
| `job-start` | `Execute` | fire-and-forget long task; returns `job-id` only |
| `job-output` | `JobOutput` | `offset` (negative = from end) + `limit` (default 200, max 1000), `stream`; display capped at 1000 lines / 120 KiB |
| `job-wait` | `JobWait` loops | waits ≤ `timeout` s (default 60, max 600); returns the latest 200 lines |
| `job-kill` | `JobKill` | process-tree kill |
| `job-stdin` | `JobStdin` | write/close a job's stdin |
| `job-list` | `ListJobs` | id/state/exit/command |

**Files**

| Tool | Notes |
|---|---|
| `read` | text-only, `offset`/`limit` (default 200, max 1000), **line-numbered**, truncation marker; binary → error. Records the displayed lines as "seen" |
| `write` | overwrite with full content; rejected over 120 KiB; returns the numbered **whole** file; marks the whole file as "seen" |
| `edit` | 1-based line edit; `end-line < start-line` inserts, else replaces `[start-line, end-line]`; out-of-range clamps; returns a summary + unified diff. Enforces **read-before-edit** |
| `list` | breadth-first tree levels 1..`depth` (default 3), `limit` default 200 / max 1000 |
| `download` | agent `file:<code>` → workspace path |
| `upload` | workspace path → agent `file:<code>` (agent derives the MIME) |

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
| `worker-url` | easyworker base URL, e.g. `http://127.0.0.1:9090` |
| `worker-token` | worker bearer token (empty only when the worker runs with auth off) |

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
