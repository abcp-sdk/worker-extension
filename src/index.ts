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
} from './client.js'
import { workerConfig } from './config.js'
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
import { domainOf } from './tools/shared.js'

export const EXT_ID = 'worker'

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

  const clientFor = (
    session: string,
    tenant: string,
    locale: string,
  ): WorkerClient =>
    makeClient(workerConfig(opts.getConfig, session, tenant, locale))

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
      const cfg = workerConfig(opts.getConfig, s, t, locale)
      return fn(
        {
          client: makeClient(cfg),
          url: cfg.url,
          tenant: t,
          session: s,
          locale,
        },
        args ?? {},
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
      return fn(
        {
          client: clientFor(s, t, locale),
          locale,
          ...(signal !== undefined ? { signal } : {}),
        },
        args ?? {},
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
      return fn(
        {
          client: clientFor(s, t, locale),
          deps,
          tenant: t,
          session: s,
          locale,
        },
        args ?? {},
      )
    }
  }

  const handlers: Handlers = {
    info: wrap(async ({ client, url, locale }) => {
      const info = await client.info({})
      const domain = domainOf(url)
      return {
        content:
          tr(locale, 'infoHeader', {
            os: info.os,
            arch: info.arch,
            shell: info.shell,
          }) +
          '\n' +
          tr(locale, 'infoWorkspace', { path: info.workspace }) +
          '\n' +
          tr(locale, 'infoService', { url: domain }) +
          '\n' +
          tr(locale, 'infoBoot', { id: info.bootId }),
        data: {
          os: info.os,
          arch: info.arch,
          shell: info.shell,
          workspace: info.workspace,
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
