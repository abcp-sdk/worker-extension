import type {
  Bus,
  ExtensionConfig,
  ToolResultData,
  ToolSpec,
} from '@abc-protocol/sdk'
import {
  manifestConfig,
  parseManifest,
  TypedToolError,
} from '@abc-protocol/sdk'
import manifestYaml from '../manifest.yaml'
import {
  type WorkerClient,
  WorkerClientCache,
  type WorkerEndpoint,
  workerAnchors,
} from './client.js'
import {
  probeCapabilities,
  type SandboxCapabilities,
} from './computer/capabilities.js'
import { probeTarget, type SandboxTarget } from './computer/target.js'
import * as C from './computer/tools.js'
import { sandboxConfig, sandboxList, type WorkerConfig } from './config.js'
import { agentFileDeps, type WorkerDeps } from './deps.js'
import { localeOf, tr } from './i18n.js'
import {
  copyFile,
  deleteFile,
  downloadFile,
  editFile,
  type FileCtx,
  listFiles,
  moveFile,
  readFile,
  uploadFile,
  writeFile,
} from './tools/files.js'
import {
  execCommand,
  type JobCtx,
  jobKill,
  jobList,
  jobOutput,
  jobStart,
  jobStdin,
  jobWait,
} from './tools/jobs.js'
import { domainOf, expandPathArgs } from './tools/shared.js'

export const EXT_ID = 'worker'

/**
 * Worker path arguments that accept a leading `~` alias for the worker's HOME.
 * Expanded client-side before the call (the worker does not expand `~`).
 */
const PATH_KEYS = ['path', 'dest', 'from', 'to', 'workdir'] as const

/** How long a probed target / capability list is reused before re-probing. */
const PROBE_TTL_MS = 30_000

/** Tool schemas + descriptions come from the manifest; code supplies handlers. */
const manifest = parseManifest(manifestYaml)

type Handlers = Record<string, ToolSpec['execute']>

export interface WorkerExtensionOpts {
  /** Read the effective config (session > global > default) for a tenant. */
  getConfig: (name: string, sessionName?: string, tenant?: string) => unknown
  deps?: WorkerDeps
  /** Worker client factory (overridable in tests). */
  makeClient?: (ep: WorkerEndpoint) => WorkerClient
}

/**
 * Build the worker extension: run commands, read/write files, AND drive a
 * native GUI (through the platform accessibility tree) in the SAME set of
 * config-registered easyworker sandboxes. Every tool takes an optional
 * `sandbox` argument selecting one of the `sandboxes` entries by name; the
 * `worker-*` tools (exec/files) and the `computer-*` tools (GUI) address the
 * same sandboxes. The `workspace` extension adds dynamic sandbox lifecycle +
 * a Forgejo (git) backend on top.
 *
 * `bus` is only needed for the agent file RPCs (download/upload/screenshot).
 */
export function createWorkerConfig(
  bus: Bus | undefined,
  opts: WorkerExtensionOpts,
): ExtensionConfig {
  const deps = opts.deps ?? (bus !== undefined ? agentFileDeps(bus) : undefined)
  const cache = new WorkerClientCache()
  const makeClient = opts.makeClient ?? ((ep: WorkerEndpoint) => cache.get(ep))

  // Resolved computer-use targets keyed by `(url, token)`; a short-lived memo
  // avoids re-running info + probe for a burst of tool calls.
  const targets = new Map<string, { target: SandboxTarget; at: number }>()
  const caps = new Map<string, { value: SandboxCapabilities; at: number }>()
  const endpointKey = (cfg: WorkerConfig): string =>
    `${cfg.url}\u0000${cfg.token}`

  /** The `sandbox` argument of a call ('' = the first configured sandbox). */
  const wantedOf = (args: Record<string, unknown>): string =>
    typeof args['sandbox'] === 'string' ? String(args['sandbox']).trim() : ''

  const clientFor = (
    session: string,
    tenant: string,
    locale: string,
    wanted: string,
  ): WorkerClient =>
    makeClient(sandboxConfig(opts.getConfig, session, tenant, locale, wanted))

  /** Resolve a sandbox to a probed computer-use target (cached). */
  const resolveTarget = async (
    cfg: WorkerConfig,
    locale: string,
  ): Promise<SandboxTarget> => {
    const key = endpointKey(cfg)
    const hit = targets.get(key)
    if (hit !== undefined && Date.now() - hit.at < PROBE_TTL_MS)
      return hit.target
    const client = makeClient(cfg)
    const target = await probeTarget(client, cfg.name || cfg.url, locale)
    targets.set(key, { target, at: Date.now() })
    return target
  }

  /** Wrap a worker tool. */
  const wrap =
    (
      fn: (
        ctx: {
          client: WorkerClient
          url: string
          tenant: string
          session: string
          locale: string
        },
        args: Record<string, unknown>,
      ) => Promise<ToolResultData>,
    ): ToolSpec['execute'] =>
    async (args, _callId, sessionName, _signal, tenant) => {
      const t = tenant ?? ''
      const s = sessionName ?? ''
      const locale = await localeOf(deps, t, s)
      const a = args ?? {}
      const cfg = sandboxConfig(opts.getConfig, s, t, locale, wantedOf(a))
      const client = makeClient(cfg)
      const expanded = expandPathArgs(a, PATH_KEYS, await workerAnchors(client))
      return fn(
        {
          client,
          url: cfg.url,
          tenant: t,
          session: s,
          locale,
        },
        expanded,
      )
    }

  const jobWrap =
    (
      fn: (
        ctx: JobCtx,
        args: Record<string, unknown>,
      ) => Promise<ToolResultData>,
    ): ToolSpec['execute'] =>
    async (args, _callId, sessionName, signal, tenant) => {
      const t = tenant ?? ''
      const s = sessionName ?? ''
      const locale = await localeOf(deps, t, s)
      const a = args ?? {}
      const client = clientFor(s, t, locale, wantedOf(a))
      const expanded = expandPathArgs(a, PATH_KEYS, await workerAnchors(client))
      return fn(
        {
          client,
          locale,
          ...(signal !== undefined ? { signal } : {}),
        },
        expanded,
      )
    }

  const fileWrap = (
    fn: (
      ctx: FileCtx,
      args: Record<string, unknown>,
    ) => Promise<ToolResultData>,
  ): ToolSpec['execute'] => {
    if (deps === undefined) {
      return async () => {
        throw new TypedToolError('internal', tr('en', 'fileToolsRequireBus'))
      }
    }
    return async (args, _callId, sessionName, _signal, tenant) => {
      const t = tenant ?? ''
      const s = sessionName ?? ''
      const locale = await localeOf(deps, t, s)
      const a = args ?? {}
      const client = clientFor(s, t, locale, wantedOf(a))
      const expanded = expandPathArgs(a, PATH_KEYS, await workerAnchors(client))
      return fn(
        {
          client,
          deps,
          tenant: t,
          session: s,
          locale,
        },
        expanded,
      )
    }
  }

  /**
   * Wrap a computer-use tool: resolve the `sandbox` argument to a probed GUI
   * target (detect platform, verify the accessibility CLI) and inject the
   * computer-use call context. Same sandboxes as the worker tools.
   */
  const computerWrap =
    (
      fn: (
        ctx: C.ToolCtx,
        t: SandboxTarget,
        args: Record<string, unknown>,
      ) => Promise<ToolResultData>,
    ): ToolSpec['execute'] =>
    async (args, _callId, sessionName, _signal, tenant) => {
      const t = tenant ?? ''
      const s = sessionName ?? ''
      const locale = await localeOf(deps, t, s)
      if (deps === undefined) {
        throw new TypedToolError('internal', tr('en', 'fileToolsRequireBus'))
      }
      const a = args ?? {}
      const cfg = sandboxConfig(opts.getConfig, s, t, locale, wantedOf(a))
      const target = await resolveTarget(cfg, locale)
      const toolCtx: C.ToolCtx = {
        deps,
        locale,
        tenant: t,
        session: s,
      }
      return fn(toolCtx, target, a)
    }

  const handlers: Handlers = {
    info: wrap(async ({ client, url, locale }) => {
      const info = await client.info({})
      const domain = domainOf(url)
      const homeLine =
        info.home !== ''
          ? `\n${tr(locale, 'infoHome', { path: info.home })}`
          : ''
      return {
        content:
          tr(locale, 'infoHeader', {
            os: info.os,
            arch: info.arch,
            shell: info.shell,
          }) +
          '\n' +
          tr(locale, 'infoWorkspace', { path: info.workspace }) +
          homeLine +
          '\n' +
          tr(locale, 'infoService', { url: domain }) +
          '\n' +
          tr(locale, 'infoBoot', { id: info.bootId }),
        data: {
          os: info.os,
          arch: info.arch,
          shell: info.shell,
          workspace: info.workspace,
          home: info.home,
          url: domain,
          boot_id: info.bootId,
        },
      }
    }),
    exec: jobWrap(execCommand),
    'job-start': jobWrap(jobStart),
    'job-output': jobWrap(jobOutput),
    'job-wait': jobWrap(jobWait),
    'job-kill': jobWrap(jobKill),
    'job-stdin': jobWrap(jobStdin),
    'job-list': jobWrap(jobList),
    read: fileWrap(readFile),
    write: fileWrap(writeFile),
    edit: fileWrap(editFile),
    list: fileWrap(listFiles),
    delete: fileWrap(deleteFile),
    move: fileWrap(moveFile),
    copy: fileWrap(copyFile),
    download: fileWrap(downloadFile),
    upload: fileWrap(uploadFile),

    // ---- computer-use (GUI) — the SAME sandboxes as the worker tools ------
    'computer-apps': computerWrap(C.apps),
    'computer-snapshot': computerWrap(C.snapshot),
    'computer-find': computerWrap(C.find),
    'computer-action': computerWrap(C.action),
    'computer-click': computerWrap(C.click),
    'computer-type': computerWrap(C.typeText),
    'computer-key': computerWrap(C.key),
    'computer-scroll': computerWrap(C.scroll),
    'computer-drag': computerWrap(C.drag),
    'computer-screenshot': computerWrap(C.screenshot),

    // ---- discovery -------------------------------------------------------
    // List every registered sandbox with its OS and whether the computer-use
    // tools can drive its GUI (a11y CLI present). Cached to avoid re-probing
    // all sandboxes on every call.
    'list-sandboxes': async (_args, _callId, sessionName, _signal, tenant) => {
      const t = tenant ?? ''
      const s = sessionName ?? ''
      const locale = await localeOf(deps, t, s)
      const list = sandboxList(opts.getConfig, s, t)
      if (list.length === 0) {
        return {
          content: tr(locale, 'sandboxNone'),
          data: { sandboxes: [] },
        }
      }
      const rows = await Promise.all(
        list.map(async cfg => {
          const key = endpointKey(cfg)
          const hit = caps.get(key)
          if (hit !== undefined && Date.now() - hit.at < PROBE_TTL_MS) {
            return { cfg, caps: hit.value }
          }
          const value = await probeCapabilities(makeClient(cfg))
          caps.set(key, { value, at: Date.now() })
          return { cfg, caps: value }
        }),
      )
      const sandboxes = rows.map(({ cfg, caps: c }) => ({
        name: cfg.name,
        os: c.os,
        platform: c.platform,
        a11y: c.a11y,
      }))
      const content = rows
        .map(({ cfg, caps: c }) =>
          tr(locale, 'sandboxLine', {
            name: cfg.name,
            os: c.os === '' ? c.platform : c.os,
            a11y: tr(locale, c.a11y ? 'sandboxA11yYes' : 'sandboxA11yNo'),
          }),
        )
        .join('\n')
      return { content, data: { sandboxes } }
    },
  }

  // Tool metadata comes from manifest.yaml; only `execute` is wired here. The
  // lifecycle wiring is added AFTER manifestConfig (which does not produce it).
  const cfg = manifestConfig(manifest, {
    handlers: Object.fromEntries(
      Object.entries(handlers).map(([k, v]) => [k, { execute: v }]),
    ),
  })
  cfg.lifecycle = ['deleted']
  cfg.onLifecycle = async (ev, tenant) => {
    if (ev.kind !== 'deleted') return
    if (deps === undefined) return
    await deps.clearEditState(tenant ?? '', ev.session_name).catch(() => {})
  }
  return cfg
}
