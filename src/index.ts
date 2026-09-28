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
import { sandboxConfig, sandboxNames } from './config.js'
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
 * Build the worker extension: run commands and read/write files in ONE fixed
 * easyworker sandbox, addressed by `worker-url`/`worker-token`. This is the
 * stable single-worker variant; the `workspace` extension adds dynamic sandbox
 * lifecycle + a Forgejo (git) backend on top.
 *
 * `bus` is only needed for the agent file RPCs (download/upload).
 */
export function createWorkerConfig(
  bus: Bus | undefined,
  opts: WorkerExtensionOpts,
): ExtensionConfig {
  const deps = opts.deps ?? (bus !== undefined ? agentFileDeps(bus) : undefined)
  const cache = new WorkerClientCache()
  const makeClient = opts.makeClient ?? ((ep: WorkerEndpoint) => cache.get(ep))

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
    // List the sandboxes registered in config (no creation — config only).
    'worker-sandboxes': async (
      _args,
      _callId,
      sessionName,
      _signal,
      tenant,
    ) => {
      const t = tenant ?? ''
      const s = sessionName ?? ''
      const locale = await localeOf(deps, t, s)
      const names = sandboxNames(opts.getConfig, s, t)
      return {
        content:
          names.length === 0 ? tr(locale, 'sandboxNone') : names.join('\n'),
        data: { sandboxes: names },
      }
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
