import type {
  Bus,
  ExtensionConfig,
  ConfigSpec,
  ToolResultData,
  ToolSpec,
} from '@abc-protocol/sdk'
import { TypedToolError } from '@abc-protocol/sdk'
import {
  type WorkerClient,
  WorkerClientCache,
  type WorkerEndpoint,
} from './client.js'
import { agentFileDeps, type WorkerDeps } from './deps.js'
import { CONFIG, WORKER_REQUIRED, workerConfig } from './config.js'
import { localeOf, tr } from './i18n.js'
import {
  downloadFile,
  editFile,
  type FileCtx,
  listFiles,
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

export const EXT_ID = 'worker'
export const EXT_VERSION = '0.1.0'

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

  const clientFor = (session: string, tenant: string, locale: string): WorkerClient =>
    makeClient(workerConfig(opts.getConfig, session, tenant, locale))

  /** Wrap a worker tool. */
  const wrap = (
    fn: (ctx: { client: WorkerClient; tenant: string; session: string; locale: string }, args: Record<string, unknown>) => Promise<ToolResultData>,
  ): ToolSpec['execute'] =>
    async (args, _callId, sessionName, _signal, tenant) => {
      const t = tenant ?? ''
      const s = sessionName ?? ''
      const locale = await localeOf(deps, t, s)
      return fn({ client: clientFor(s, t, locale), tenant: t, session: s, locale }, args ?? {})
    }

  const jobWrap = (
    fn: (ctx: JobCtx, args: Record<string, unknown>) => Promise<ToolResultData>,
  ): ToolSpec['execute'] =>
    async (args, _callId, sessionName, signal, tenant) => {
      const t = tenant ?? ''
      const s = sessionName ?? ''
      const locale = await localeOf(deps, t, s)
      return fn(
        { client: clientFor(s, t, locale), locale, ...(signal !== undefined ? { signal } : {}) },
        args ?? {},
      )
    }

  const fileWrap = (
    fn: (ctx: FileCtx, args: Record<string, unknown>) => Promise<ToolResultData>,
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
      return fn({ client: clientFor(s, t, locale), deps, tenant: t, session: s, locale }, args ?? {})
    }
  }

  const handlers: Handlers = {
    info: wrap(async ({ client, locale }) => {
      const info = await client.info({})
      return {
        content:
          tr(locale, 'infoHeader', { os: info.os, arch: info.arch, shell: info.shell }) +
          '\n' +
          tr(locale, 'infoWorkspace', { path: info.workspace }) +
          '\n' +
          tr(locale, 'infoBoot', { id: info.bootId }),
        data: { os: info.os, arch: info.arch, shell: info.shell, workspace: info.workspace, boot_id: info.bootId },
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
    download: fileWrap(downloadFile),
    upload: fileWrap(uploadFile),
  }

  const tools: Record<string, ToolSpec> = {}
  for (const [name, meta] of Object.entries(TOOL_META)) {
    const execute = handlers[name]
    if (execute === undefined) continue
    const spec: ToolSpec = {
      description: meta.description,
      inputSchema: meta.inputSchema,
      requiredConfig: WORKER_REQUIRED,
      execute,
    }
    if (meta.descriptions !== undefined) spec.descriptions = meta.descriptions
    tools[name] = spec
  }

  return {
    id: EXT_ID,
    version: EXT_VERSION,
    tools,
    lifecycle: ['deleted'],
    onLifecycle: async (ev, tenant) => {
      if (ev.kind !== 'deleted') return
      if (deps === undefined) return
      await deps.clearEditState(tenant ?? '', ev.session_name).catch(() => {})
    },
    config: CONFIG_SPECS,
  }
}

/** All config knobs (declared once). */
const CONFIG_SPECS: Record<string, ConfigSpec> = {
  [CONFIG.workerUrl]: {
    type: 'string',
    default: '',
    scope: 'global',
    description: 'Base URL of the easyworker sandbox (e.g. http://127.0.0.1:9090).',
    descriptions: { zh: 'easyworker 沙箱的基础地址（如 http://127.0.0.1:9090）。' },
  },
  [CONFIG.workerToken]: {
    type: 'string',
    default: '',
    scope: 'global',
    description: 'easyworker bearer token (empty only when the worker has auth disabled).',
    descriptions: { zh: 'easyworker 的 bearer 令牌（仅当 worker 关闭鉴权时才可留空）。' },
  },
}

interface ToolMeta {
  description: string
  descriptions?: Record<string, string>
  inputSchema: Record<string, unknown>
}

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({ type: 'object', properties, required })

const str = (description: string, descriptionsZh?: string): Record<string, unknown> => ({
  type: 'string',
  description,
  ...(descriptionsZh !== undefined ? { descriptions: { zh: descriptionsZh } } : {}),
})

const int = (description: string, descriptionsZh?: string): Record<string, unknown> => ({
  type: 'integer',
  description,
  ...(descriptionsZh !== undefined ? { descriptions: { zh: descriptionsZh } } : {}),
})

const JOB_ID = str('Background job id.', '后台任务 id。')

const TOOL_META: Record<string, ToolMeta> = {
  info: {
    description: 'Show the connected easyworker environment: OS/arch, shell, workspace root and boot id.',
    descriptions: { zh: '查看所连 easyworker 的环境：OS/架构、shell、工作区根目录与 boot id。' },
    inputSchema: obj({}),
  },
  exec: {
    description:
      'Run a short shell command in the worker workspace and wait up to `timeout` seconds. Returns the job id always; on completion up to 1000 lines of output, on timeout the oldest 200 lines plus a note that the job is still running.',
    descriptions: { zh: '在工作区运行一个短命令，最多等待 `timeout` 秒。总是返回 job id；完成时最多返回 1000 行输出，超时则返回最旧的 200 行并提示任务仍在运行。' },
    inputSchema: obj(
      {
        command: str('Shell command to run.', '要运行的 shell 命令。'),
        workdir: str('Working directory, relative to the workspace root.', '工作目录，相对于工作区根目录。'),
        timeout: int('Synchronous wait ceiling in seconds (default 5, max 60).', '同步等待上限（秒，默认 5，最大 60）。'),
        env: {
          type: 'object',
          description: 'Extra environment variables for the job.',
          descriptions: { zh: '为任务附加的环境变量。' },
          additionalProperties: { type: 'string' },
        },
      },
      ['command'],
    ),
  },
  'job-start': {
    description: 'Start a long-running shell command and return the job id immediately (no waiting). Drive it with job-wait/job-output/job-stdin/job-kill.',
    descriptions: { zh: '启动一个长时间运行的 shell 命令并立即返回 job id（不等待）。用 job-wait/job-output/job-stdin/job-kill 进行后续控制。' },
    inputSchema: obj(
      {
        command: str('Shell command to run.', '要运行的 shell 命令。'),
        workdir: str('Working directory, relative to the workspace root.', '工作目录，相对于工作区根目录。'),
        env: {
          type: 'object',
          description: 'Extra environment variables for the job.',
          descriptions: { zh: '为任务附加的环境变量。' },
          additionalProperties: { type: 'string' },
        },
      },
      ['command'],
    ),
  },
  'job-output': {
    description: "Read a job's output by line window (offset/limit; offset negative counts from the end). Display is capped at 1000 lines / 120 KiB.",
    descriptions: { zh: '按行窗口读取任务输出（offset/limit；offset 为负从末尾计数）。展示上限 1000 行 / 120 KiB。' },
    inputSchema: obj({
      'job-id': JOB_ID,
      offset: int('Start line offset (negative = from the end, default 0).', '起始行偏移（负值从末尾算，默认 0）。'),
      limit: int('Maximum lines to return (default 200, max 1000).', '最多返回行数（默认 200，最大 1000）。'),
      stream: {
        type: 'string',
        enum: ['all', 'stdout', 'stderr'],
        description: 'Which stream to read (default all).',
        descriptions: { zh: '读取哪个流（默认 all）。' },
      },
    }, ['job-id']),
  },
  'job-wait': {
    description: 'Wait up to `timeout` seconds for a job to finish; returns the latest 200 lines of output. If it is still running at the deadline, says so.',
    descriptions: { zh: '最多等待 `timeout` 秒让任务结束；返回最新的 200 行输出。若到点仍在运行则明确提示。' },
    inputSchema: obj(
      {
        'job-id': JOB_ID,
        timeout: int('Wait ceiling in seconds (default 60, max 600).', '等待上限（秒，默认 60，最大 600）。'),
      },
      ['job-id'],
    ),
  },
  'job-kill': {
    description: 'Kill a job and its whole process tree.',
    descriptions: { zh: '终止任务及其整个进程树。' },
    inputSchema: obj({ 'job-id': JOB_ID }, ['job-id']),
  },
  'job-stdin': {
    description: "Write to a job's stdin, optionally closing it.",
    descriptions: { zh: '向任务的 stdin 写入数据，可选关闭。' },
    inputSchema: obj(
      {
        'job-id': JOB_ID,
        data: str('Text to write to stdin.', '写入 stdin 的文本。'),
        close: {
          type: 'boolean',
          description: 'Close stdin after writing.',
          descriptions: { zh: '写入后关闭 stdin。' },
        },
      },
      ['job-id'],
    ),
  },
  'job-list': {
    description: 'List jobs registered in the worker (id, state, exit code, command).',
    descriptions: { zh: '列出 worker 中登记的任务（id、状态、退出码、命令）。' },
    inputSchema: obj({}),
  },
  read: {
    description: 'Read a text file from the workspace with line numbers, windowed by offset/limit. Binary files are rejected. Reading records the lines as "seen" so a later edit may change them.',
    descriptions: { zh: '从工作区读取文本文件并带行号，通过 offset/limit 分窗。二进制文件会被拒绝。读取会记录已“看到”的行，之后 edit 才能修改这些行。' },
    inputSchema: obj(
      {
        path: str('File path, relative to the workspace root.', '文件路径，相对于工作区根目录。'),
        offset: int('Start line (0-based, default 0).', '起始行（从 0 开始，默认 0）。'),
        limit: int('Maximum lines (default 200, max 1000).', '最多行数（默认 200，最大 1000）。'),
      },
      ['path'],
    ),
  },
  write: {
    description: 'Write (overwrite) a text file in the workspace, then return the whole file with line numbers. Rejected if the content exceeds 120 KiB. The whole file counts as "seen", so it can be edited afterwards.',
    descriptions: { zh: '向工作区写入（覆盖）文本文件，随后返回带行号的全文件。内容超过 120 KiB 会被拒绝。整个文件视为已“看到”，之后可直接 edit。' },
    inputSchema: obj(
      {
        path: str('File path, relative to the workspace root.', '文件路径，相对于工作区根目录。'),
        content: str('Full file content.', '完整文件内容。'),
      },
      ['path', 'content'],
    ),
  },
  edit: {
    description: 'Edit a workspace file by line numbers (1-based). When end-line < start-line it inserts before start-line; otherwise it replaces [start-line, end-line]. Out-of-range line numbers are clamped to the file. The session must have read (or written) the file first, and may only edit lines it has seen; the file must be unchanged since that read. A successful edit requires a fresh read before the next edit (line numbers may shift). Returns a one-line summary followed by a unified diff.',
    descriptions: { zh: '按行号（从 1 开始）编辑工作区文件。end-line < start-line 时在 start-line 前插入；否则替换 [start-line, end-line]。越界行号会夹取到文件范围。会话必须先 read（或 write）过该文件，且只能修改已“看到”的行；文件自上次读取后不得变化。编辑成功后需重新 read 才能再次 edit（行号可能已改变）。返回一行摘要及本次改动的 unified diff。' },
    inputSchema: obj(
      {
        path: str('File path, relative to the workspace root.', '文件路径，相对于工作区根目录。'),
        'start-line': int('Start line (1-based).', '起始行（从 1 开始）。'),
        'end-line': int('End line (1-based, inclusive); < start-line means insert.', '结束行（从 1 开始，含端点）；小于 start-line 表示插入。'),
        content: str('Replacement or inserted text.', '替换或插入的文本。'),
      },
      ['path', 'start-line', 'end-line'],
    ),
  },
  list: {
    description: 'List a workspace path as a breadth-first tree (levels 1..depth) with sizes. Directories beyond the cap stay collapsed.',
    descriptions: { zh: '以广度优先树（第 1..depth 层）列出工作区路径并显示大小。超过上限的目录保持折叠。' },
    inputSchema: obj(
      {
        path: str('Directory or file path, relative to the workspace root.', '目录或文件路径，相对于工作区根目录。'),
        limit: int('Maximum entries (default 200, max 1000).', '最大条目数（默认 200，最大 1000）。'),
        depth: int('Levels to expand (default 3).', '展开层数（默认 3）。'),
      },
      ['path'],
    ),
  },
  download: {
    description: 'Download a stored file (agent `file:<code>`) into the workspace at `path`.',
    descriptions: { zh: '将已存储文件（agent 的 `file:<code>`）下载到工作区的 `path`。' },
    inputSchema: obj(
      {
        code: str('File code (with or without the `file:` prefix).', '文件 code（可带或不带 `file:` 前缀）。'),
        path: str('Destination path in the workspace.', '工作区中的目标路径。'),
      },
      ['code', 'path'],
    ),
  },
  upload: {
    description: 'Upload a workspace file to the agent file store, returning its `file:<code>`. The content type is derived by the agent.',
    descriptions: { zh: '将工作区文件上传到 agent 文件存储，返回 `file:<code>`。内容类型由 agent 推断。' },
    inputSchema: obj(
      {
        path: str('File path, relative to the workspace root.', '文件路径，相对于工作区根目录。'),
        name: str('Stored file name (defaults to the basename).', '存储文件名（默认取 basename）。'),
      },
      ['path'],
    ),
  },
}
