import type { WorkerClient } from '../client.js'
import { isSettled, run } from './exec.js'
import { detectPlatform, type PlatformId } from './target.js'

/** What a sandbox is and whether the computer-use tools can drive its GUI. */
export interface SandboxCapabilities {
  /** Raw `info.os` reported by the worker (may be ''). */
  os: string
  /** Detected platform family (linux when os is unknown/empty). */
  platform: PlatformId
  /** True when the CLI the computer-use tools need is present in the sandbox. */
  a11y: boolean
}

/**
 * Probe a sandbox's capabilities for the discovery tool: the worker's `info.os`
 * plus whether the accessibility CLI is installed. This is deliberately
 * LIGHTWEIGHT — it only checks that the binary exists (`command -v`), unlike
 * `probeTarget` which also waits for the a11y bus / Android emulator to come up.
 * A sandbox that reports `a11y=true` here may still fail a computer-* call if
 * its bus is not running yet; a `false` reliably means the call cannot work.
 */
export async function probeCapabilities(
  client: WorkerClient,
): Promise<SandboxCapabilities> {
  let os = ''
  try {
    os = (await client.info({})).os
  } catch {
    os = ''
  }
  const platform = detectPlatform(os)
  const cmd = platform === 'android' ? 'command -v adb' : 'command -v xa11y'
  let a11y = false
  try {
    const res = await run(client, cmd, { timeoutMs: 10_000 })
    a11y = isSettled(res.state) && res.stdout.trim() !== ''
  } catch {
    a11y = false
  }
  return { os, platform, a11y }
}
