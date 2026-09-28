import { TypedToolError } from '@abc-protocol/sdk'
import type { WorkerClient } from '../client.js'
import { tr } from '../i18n.js'
import { AndroidPlatform, type Platform, Xa11yPlatform } from './platform.js'

/**
 * A resolved computer-use target: a sandbox name bound to the worker client and
 * the platform driver that talks to it. Tools receive this directly; there is
 * no context id or session binding.
 *
 * `sandbox` is a display/diagnostic label (a name or id); the fixed-worker
 * server sets it to the configured worker, the dynamic server to the sandbox
 * name.
 */
export interface SandboxTarget {
  sandbox: string
  platform: Platform
  client: WorkerClient
}

/** The platform families a computer-use target can be driven on. */
export type PlatformId = 'linux' | 'android' | 'windows' | 'macos'

/**
 * Decide the platform from the sandbox OS reported by the worker.
 *
 * An unknown/empty OS is treated as Linux: the desktop image's worker is
 * Linux, and it is the safe default for the X11 sandbox.
 */
export function detectPlatform(os: string): PlatformId {
  const s = os.trim().toLowerCase()
  if (s === 'android') return 'android'
  if (s === 'windows') return 'windows'
  if (s === 'darwin' || s === 'macos') return 'macos'
  return 'linux'
}

/** Build the `Platform` driver for a detected platform id. */
export function createPlatform(client: WorkerClient, id: PlatformId): Platform {
  return id === 'android'
    ? new AndroidPlatform(client)
    : new Xa11yPlatform(client, id)
}

/**
 * Detect the sandbox platform (from the worker's own `info.os`), build its
 * driver, and probe for the required CLI. Throws a typed error when the
 * sandbox is not a computer-use target or the CLI is missing.
 *
 * `sandbox` is only used for error text. Both servers share this so a fixed
 * worker and a named sandbox behave identically.
 */
export async function probeTarget(
  client: WorkerClient,
  sandbox: string,
  locale: string,
): Promise<SandboxTarget> {
  let os = ''
  try {
    os = (await client.info({})).os
  } catch {
    os = ''
  }
  const platform = createPlatform(client, detectPlatform(os))
  try {
    await platform.probe()
  } catch {
    throw new TypedToolError(
      'not_found',
      tr(locale, 'a11yMissing', { sandbox }),
    )
  }
  return { sandbox, platform, client }
}
