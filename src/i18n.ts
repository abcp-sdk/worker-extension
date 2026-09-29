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
  infoHome: {
    en: 'home (~): {path}',
    zh: '主目录（~）：{path}',
  },
  infoService: {
    en: 'service: {url}',
    zh: '服务：{url}',
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
  startedJobTimeout: {
    en: 'A {timeout}s deadline is armed: at expiry the job is killed (output kept).',
    zh: '已设置 {timeout} 秒截止：到点后任务会被杀死（保留输出）。',
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
  deleteFailed: {
    en: "failed to delete '{path}'.",
    zh: "删除 '{path}' 失败。",
  },
  deletedPath: {
    en: "deleted '{path}'.",
    zh: "已删除 '{path}'。",
  },
  moveFailed: {
    en: "failed to move '{from}' to '{to}'.",
    zh: "将 '{from}' 移动到 '{to}' 失败。",
  },
  movedPath: {
    en: "moved '{from}' to '{to}'.",
    zh: "已将 '{from}' 移动到 '{to}'。",
  },
  copyFailed: {
    en: "failed to copy '{from}' to '{to}'.",
    zh: "将 '{from}' 复制到 '{to}' 失败。",
  },
  copiedPath: {
    en: "copied '{from}' to '{to}'.",
    zh: "已将 '{from}' 复制到 '{to}'。",
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

  // ---- computer-use (GUI via accessibility) ----
  a11yMissing: {
    en: 'the accessibility CLI (xa11y) is not available in sandbox {sandbox} (or the accessibility bus is not running). Rebuild the sandbox image with xa11y (see agent-toolchain/desktop and agent-toolchain/vm).',
    zh: '沙箱 {sandbox} 中没有无障碍 CLI（xa11y），或无障碍总线未运行。请用带 xa11y 的镜像重建沙箱（见 agent-toolchain/desktop 与 agent-toolchain/vm）。',
  },
  noApps: {
    en: 'No applications found.',
    zh: '未找到应用。',
  },
  noMatches: {
    en: 'no elements matched selector: {selector}',
    zh: '没有元素匹配选择器：{selector}',
  },
  findByRefHint: {
    en: 'Tip: call computer-snapshot first to get element refs, or use a selector like button[name="OK"].',
    zh: '提示：先调用 computer-snapshot 获取元素 ref，或使用类似 button[name="OK"] 的选择器。',
  },
  actionDone: {
    en: 'Performed {action} on {target}.',
    zh: '已对 {target} 执行 {action}。',
  },
  clickedAt: {
    en: 'Clicked at ({x},{y}).',
    zh: '已在 ({x},{y}) 点击。',
  },
  typedText: {
    en: 'Typed {count} character(s).',
    zh: '已输入 {count} 个字符。',
  },
  pressedKey: {
    en: 'Pressed {key}.',
    zh: '已按下 {key}。',
  },
  scrolled: {
    en: 'Scrolled at ({x},{y}) by ({dx},{dy}).',
    zh: '已在 ({x},{y}) 滚动 ({dx},{dy})。',
  },
  dragged: {
    en: 'Dragged ({fromX},{fromY}) -> ({toX},{toY}).',
    zh: '已拖拽 ({fromX},{fromY}) -> ({toX},{toY})。',
  },
  screenshotStored: {
    en: 'Screenshot stored as file:{code} ({width}x{height}).',
    zh: '截图已存储为 file:{code}（{width}x{height}）。',
  },
  screenshotFailed: {
    en: 'screenshot failed: {reason}',
    zh: '截图失败：{reason}',
  },

  // ---- list-sandboxes ----
  sandboxLine: {
    en: '{name}\t{os}\ta11y={a11y}',
    zh: '{name}\t{os}\ta11y={a11y}',
  },
  sandboxA11yYes: {
    en: 'yes',
    zh: 'yes',
  },
  sandboxA11yNo: {
    en: 'no',
    zh: 'no',
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
  unknownTarget: {
    en: 'unknown sandbox `{target}`; configured sandboxes: {known}',
    zh: '未知 sandbox `{target}`；已配置的 sandbox：{known}',
  },
  sandboxNone: {
    en: '(no sandboxes configured)',
    zh: '（未配置 sandbox）',
  },
  fileToolsRequireBus: {
    en: 'file tools require an agent bus (download/upload)',
    zh: '文件工具需要 agent bus（download/upload）。',
  },
  argRequired: {
    en: '{key} is required',
    zh: '缺少 {key}。',
  },
  editStartAnchorRange: {
    en: 'start-anchor-line {start} is out of range: it must be between 0 and the number of lines ({total}); use 0 to insert at the head.',
    zh: 'start-anchor-line {start} 越界：必须在 0 到总行数（{total}）之间；在文件头插入请用 0。',
  },
  editEndAnchorRange: {
    en: 'end-anchor-line {end} is out of range: it must be between 1 and the number of lines + 1 ({total} + 1); use total + 1 to append at the tail.',
    zh: 'end-anchor-line {end} 越界：必须在 1 到总行数 + 1（{total} + 1）之间；在文件尾追加请用总行数 + 1。',
  },
  editAnchorOrder: {
    en: 'end-anchor-line ({end}) must be greater than start-anchor-line ({start}); the two anchor the unchanged lines just outside the edit region.',
    zh: 'end-anchor-line（{end}）必须大于 start-anchor-line（{start}）；两者锚定编辑区两侧的不变行。',
  },
  editAnchorMissing: {
    en: "the anchor line {kind} the edit region (line {line} of '{path}') exists but '{kind}-anchor' is empty; pass its current text. That line is: {actual}",
    zh: "编辑区{kindSide}的锚行（'{path}' 第 {line} 行）存在，但 '{kind}-anchor' 为空；请传该行当前原文。该行内容：{actual}",
  },
  editAnchorMismatch: {
    en: "'{kind}-anchor' (line {line} of '{path}', the unchanged line {kindSide} the edit region) does not match: expected {expected}, found {actual}. The file or line numbers changed; call read again.",
    zh: "'{kind}-anchor'（'{path}' 第 {line} 行，即编辑区{kindSide}的不变行）不匹配：期望 {expected}，实际 {actual}。文件或行号已变化；请重新 read。",
  },
  editAnchorOutOfRange: {
    en: "'{kind}-anchor' was given for line {line}, which does not exist in '{path}' ({total} lines); pass an empty string instead.",
    zh: "'{path}'（{total} 行）中不存在第 {line} 行，'{kind}-anchor' 应传空字符串。",
  },
  editAnchorRequired: {
    en: "'{key}' is a required argument; pass the current text of the line it anchors, or an empty string when that line does not exist.",
    zh: "'{key}' 是必填参数；请传其锚定行的当前原文，该行不存在时传空字符串。",
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
