import { TypedToolError } from '@abc-protocol/sdk'
import { tr } from './i18n.js'

/** Config knob names (single source of truth for the manifest + readers). */
export const CONFIG = {
  workerUrl: 'worker-url',
  workerToken: 'worker-token',
} as const

/** Every tool requires a reachable worker. */
export const WORKER_REQUIRED = [CONFIG.workerUrl, CONFIG.workerToken]

export type GetConfig = (name: string, sessionName?: string, tenant?: string) => unknown

/** Read a config string ('' when unset/wrong type). */
export function cfgRaw(get: GetConfig, name: string, session: string, tenant: string): string {
  const v = get(name, session, tenant)
  return typeof v === 'string' ? v.trim() : ''
}

/** Read a REQUIRED config string, throwing a typed error when unset. */
export function cfgString(
  get: GetConfig,
  name: string,
  session: string,
  tenant: string,
  locale: string,
): string {
  const v = cfgRaw(get, name, session, tenant)
  if (v === '') {
    throw new TypedToolError('invalid_argument', tr(locale, 'notConfigured', { name }))
  }
  return v
}

/** The worker endpoint. */
export interface WorkerConfig {
  url: string
  token: string
}

export function workerConfig(get: GetConfig, session: string, tenant: string, locale: string): WorkerConfig {
  return {
    url: cfgString(get, CONFIG.workerUrl, session, tenant, locale),
    // An empty token is allowed (a worker with auth disabled).
    token: cfgRaw(get, CONFIG.workerToken, session, tenant),
  }
}
