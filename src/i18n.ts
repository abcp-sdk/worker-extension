import {
  BASE_LOCALE,
  type Catalog,
  defineI18n,
  translate,
} from '@abc-protocol/sdk'
import type { WorkerDeps } from './deps.js'

/**
 * worker-extension message catalog for RUNTIME tool text (content + error) that
 * reaches the model. Tool DESCRIPTIONS are localized separately through the
 * manifest (`description` + `descriptions[locale]`).
 *
 * The locale set is an OPEN map: add a language by adding a column to each
 * entry — no code change. New keys are type-checked against this object, so a
 * typo in `t(locale, '...')` fails to compile.
 */
export const CATALOG = {
  // ---- info ----
  infoHeader: {
    en: 'easyworker {os}/{arch} (shell {shell})',
    zh: 'easyworker {os}/{arch}（shell {shell}）',
  },
  infoWorkspace: {
    en: 'workspace: {path}',
    zh: '工作区：{path}',
  },
  infoBoot: {
    en: 'boot_id: {id}',
    zh: 'boot_id：{id}',
  },

  // ---- exec / jobs ----
  execStillRunning: {
    en: 'Job {jobId} is still running after {timeout}s.',
    zh: '任务 {jobId} 在 {timeout} 秒后仍在运行。',
  },
  execUseJobOutput: {
    en: 'Use job-output (job-id: {jobId}) to see more output.',
    zh: '使用 job-output（job-id：{jobId}）查看更多输出。',
  },
  commandFinished: {
    en: 'Command finished (job {jobId}, {state}, exit {code}).',
    zh: '命令已结束（任务 {jobId}，{state}，退出码 {code}）。',
  },
  startedJob: {
    en: 'Started job {jobId}.',
    zh: '已启动任务 {jobId}。',
  },
  jobStillRunning: {
    en: 'Job {jobId} is still running after {timeout}s.',
    zh: '任务 {jobId} 在 {timeout} 秒后仍在运行。',
  },
  jobFinished: {
    en: 'Job {jobId} {state} (exit {code}).',
    zh: '任务 {jobId} {state}（退出码 {code}）。',
  },
  killedJob: {
    en: 'Killed job {jobId}.',
    zh: '已终止任务 {jobId}。',
  },
  wroteStdin: {
    en: 'Wrote {n} chars to job {jobId} stdin.',
    zh: '已向任务 {jobId} 的 stdin 写入 {n} 个字符。',
  },
  wroteStdinClosed: {
    en: 'Wrote {n} chars to job {jobId} stdin and closed it.',
    zh: '已向任务 {jobId} 的 stdin 写入 {n} 个字符并关闭。',
  },
  noJobs: {
    en: 'No jobs.',
    zh: '没有任务。',
  },

  // ---- files ----
  notTextFile: {
    en: "'{path}' is not a text file (binary content); read supports text files only",
    zh: "'{path}' 不是文本文件（二进制内容）；read 只支持文本文件。",
  },
  wroteFile: {
    en: "Wrote {bytes} bytes to '{path}' ({lines} lines).",
    zh: "已向 '{path}' 写入 {bytes} 字节（{lines} 行）。",
  },
  writeTooLarge: {
    en: "'{path}' is {bytes} bytes; write is limited to {limit} (build larger files in the workspace instead).",
    zh: "'{path}' 为 {bytes} 字节；write 上限为 {limit}（更大的文件请在 workspace 内生成）。",
  },
  writeFailed: {
    en: "failed to write '{path}'.",
    zh: "写入 '{path}' 失败。",
  },
  editSummary: {
    en: "Edited '{path}': +{added} -{removed} (now {lines} lines).",
    zh: "已编辑 '{path}'：+{added} -{removed}（现为 {lines} 行）。",
  },
  editNoChanges: {
    en: "No changes to '{path}'.",
    zh: "'{path}' 没有变化。",
  },
  emptyRoot: {
    en: '(workspace root is empty)',
    zh: '（工作区根目录为空）',
  },
  emptyDir: {
    en: '(empty: {path})',
    zh: '（空：{path}）',
  },
  downloaded: {
    en: "Downloaded file:{code} ({mime}, {bytes} bytes) to '{path}'.",
    zh: "已下载 file:{code}（{mime}，{bytes} 字节）到 '{path}'。",
  },
  uploaded: {
    en: "Uploaded '{path}' as file:{code} ({mime}, {bytes} bytes).",
    zh: "已上传 '{path}' 为 file:{code}（{mime}，{bytes} 字节）。",
  },

  // ---- truncation / paging notes ----
  truncatedAfter: {
    en: '... truncated after {shown} of {total} lines ({why}); narrow the range (offset/limit) to see more.',
    zh: '... 已在 {total} 行中截断至 {shown} 行（{why}）；用 offset/limit 缩小范围以查看更多。',
  },
  whyBytes: {
    en: 'result exceeds {size}',
    zh: '结果超过 {size}',
  },
  whyLines: {
    en: 'result exceeds {lines} lines',
    zh: '结果超过 {lines} 行',
  },
  showingLines: {
    en: '... showing lines {start}-{end} of {total}',
    zh: '... 正在显示第 {start}-{end} 行，共 {total} 行',
  },
  moreLinesAvailable: {
    en: ' (more lines available; use offset/limit)',
    zh: '（还有更多行；请使用 offset/limit）',
  },
  omittedEntries: {
    en: '... {path}: {count} entries omitted (limit {limit})',
    zh: '... {path}：省略 {count} 个条目（上限 {limit}）',
  },

  // ---- errors (config / args) ----
  notConfigured: {
    en: "{name} is not configured; set it in the extension's tool settings",
    zh: '未配置 {name}；请在扩展的工具设置中填写。',
  },
  fileToolsRequireBus: {
    en: 'file tools require an agent bus (download/upload)',
    zh: '文件工具需要 agent bus（download/upload）。',
  },
  argRequired: {
    en: '{key} is required',
    zh: '缺少 {key}。',
  },
  startLineMin: {
    en: 'start-line must be >= 1',
    zh: 'start-line 必须 >= 1。',
  },
  editNeedsRead: {
    en: "'{path}' has not been read in this session; call read first (read the lines you intend to edit).",
    zh: "本会话尚未读取 '{path}'；请先调用 read 工具（读取你要编辑的行）。",
  },
  editStaleRead: {
    en: "'{path}' changed since it was last read; call read again before editing (line numbers may have shifted).",
    zh: "'{path}' 自上次读取后已变化；请重新调用 read 工具后再编辑（行号可能已改变）。",
  },
  editRangeNotRead: {
    en: "lines {start}-{end} of '{path}' were not read; call read for that range first (seen: {seen}).",
    zh: "尚未读取 '{path}' 的第 {start}-{end} 行；请先调用 read 工具读取该范围（已读：{seen}）。",
  },
  tenantRequired: {
    en: '{op}: tenant required',
    zh: '{op}：缺少 tenant。',
  },
  fileNotFound: {
    en: 'file not found: {code}',
    zh: '未找到文件：{code}。',
  },
  interrupted: {
    en: 'interrupted',
    zh: '已中断。',
  },
} satisfies Catalog<string>

export type MessageKey = keyof typeof CATALOG

const { t } = defineI18n(CATALOG)

/** Translate a worker message into `locale`. */
export function tr(
  locale: string,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return t(locale, key, params)
}

/** Read the session's effective locale (agent-projected), '' when unknown. */
export async function localeOf(
  deps: WorkerDeps | undefined,
  tenant: string,
  session: string,
): Promise<string> {
  if (deps === undefined || session === '') return BASE_LOCALE
  const v = await deps
    .getSessionVariable(tenant, 'agent', session, 'locale')
    .catch(() => '')
  return v === '' ? BASE_LOCALE : v
}

export { translate }
