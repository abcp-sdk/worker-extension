import { type Bus, connectNatsBus, Extension } from '@abc-protocol/sdk'
import { createWorkerConfig } from './index.js'

export interface ServeWorkerOpts {
  /** NATS URL the extension connects to (shared with the agent). */
  natsUrl: string
}

/**
 * Connect to NATS and serve the worker extension. The URL + token are read per
 * call from extension config, so serving needs no worker details up front.
 * Resolves once the extension has registered; returns a stop function.
 */
export async function serveWorker(
  opts: ServeWorkerOpts,
): Promise<{ stop: () => Promise<void>; bus: Bus }> {
  const bus = await connectNatsBus(opts.natsUrl)
  let ext: Extension | undefined
  const config = createWorkerConfig(bus, {
    getConfig: (name, sessionName, tenant) =>
      ext?.getConfig(name, sessionName, tenant ?? ''),
  })
  ext = new Extension(bus, config)
  await ext.serve()
  return {
    bus,
    stop: async () => {
      await ext?.close()
    },
  }
}
