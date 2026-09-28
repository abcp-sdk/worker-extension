import { TypedToolError } from '@abc-protocol/sdk'
import { tr } from './i18n.js'

/** Config knob names (single source of truth for the manifest + readers). */
export const CONFIG = {
  sandboxes: 'sandboxes',
} as const

/**
 * Config knobs every worker tool requires (mirrored in manifest.yaml's
 * `required_config`). `required_config` is AND-only, so there is exactly ONE:
 * the `sandboxes` list. When it is unset the agent hard-disables every worker
 * tool for the model.
 */
export const WORKER_REQUIRED = [CONFIG.sandboxes]

export type GetConfig = (
  name: string,
  sessionName?: string,
  tenant?: string,
) => unknown

/** Read a config string ('' when unset/wrong type). */
export function cfgRaw(
  get: GetConfig,
  name: string,
  session: string,
  tenant: string,
): string {
  const v = get(name, session, tenant)
  return typeof v === 'string' ? v.trim() : ''
}

/** A configured sandbox endpoint. */
export interface WorkerConfig {
  /** Sandbox name. */
  name: string
  url: string
  token: string
}

/** One entry of the `sandboxes` config list. */
interface SandboxEntry {
  name: string
  url: string
  token: string
}

/** Parse the `sandboxes` JSON config into validated entries (invalid = dropped). */
export function parseSandboxes(raw: string): SandboxEntry[] {
  if (raw.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: SandboxEntry[] = []
  for (const e of parsed) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) continue
    const o = e as Record<string, unknown>
    const name = typeof o['name'] === 'string' ? o['name'].trim() : ''
    const url = typeof o['url'] === 'string' ? o['url'].trim() : ''
    const token = typeof o['token'] === 'string' ? o['token'].trim() : ''
    if (name === '' || url === '') continue
    out.push({ name, url, token })
  }
  return out
}

/** The names of every configured sandbox (for error text / discovery). */
export function sandboxNames(
  get: GetConfig,
  session: string,
  tenant: string,
): string[] {
  return parseSandboxes(cfgRaw(get, CONFIG.sandboxes, session, tenant)).map(
    s => s.name,
  )
}

/**
 * Resolve the sandbox endpoint for a tool call. `wanted` is the optional
 * `sandbox` argument: empty selects the first configured sandbox; a name
 * selects that sandbox (an unknown name is an error listing the known ones).
 */
export function sandboxConfig(
  get: GetConfig,
  session: string,
  tenant: string,
  locale: string,
  wanted = '',
): WorkerConfig {
  const list = parseSandboxes(cfgRaw(get, CONFIG.sandboxes, session, tenant))
  if (list.length === 0) {
    throw new TypedToolError(
      'invalid_argument',
      tr(locale, 'notConfigured', { name: CONFIG.sandboxes }),
    )
  }
  if (wanted === '') {
    const first = list[0]!
    return { name: first.name, url: first.url, token: first.token }
  }
  const hit = list.find(s => s.name === wanted)
  if (hit === undefined) {
    throw new TypedToolError(
      'invalid_argument',
      tr(locale, 'unknownTarget', {
        target: wanted,
        known: list.map(s => s.name).join(', '),
      }),
    )
  }
  return { name: hit.name, url: hit.url, token: hit.token }
}
