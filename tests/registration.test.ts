import {
  Agent,
  connectNatsBus,
  Extension,
  ExtensionManifestSchema,
  start,
} from '@abc-protocol/sdk'
import { afterAll, describe, expect, it } from 'vitest'
import type { WorkerClient } from '../src/client.js'
import { CONFIG, WORKER_REQUIRED } from '../src/config.js'
import { createWorkerConfig, EXT_ID } from '../src/index.js'

/** A throwing stub client — registration never calls it. */
function stubClient(): WorkerClient {
  return new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error('not called in registration test')
      },
    },
  ) as WorkerClient
}

const EXPECTED_TOOLS = [
  'download',
  'edit',
  'exec',
  'info',
  'job-kill',
  'job-list',
  'job-output',
  'job-stdin',
  'job-start',
  'job-wait',
  'list',
  'read',
  'upload',
  'write',
].sort()

describe('worker extension registration', () => {
  const stops: Array<() => Promise<void>> = []
  afterAll(async () => {
    for (const s of stops) {
      await Promise.race([
        Promise.resolve(s()).catch(() => {}),
        new Promise<void>(r => setTimeout(r, 2000)),
      ])
    }
  }, 30_000)

  it('is discoverable and advertises the (unprefixed) tool set', async () => {
    const server = await start({ storage: 'memory' })
    const url = `nats://127.0.0.1:${server.port}`
    stops.push(() => server.stop())

    const bus = await connectNatsBus(url)
    stops.push(() => bus.close())
    const ext = new Extension(
      bus,
      createWorkerConfig(bus, {
        getConfig: () => '',
        makeClient: stubClient,
      }),
    )
    await ext.serve()
    stops.push(() => ext.close())

    let manifest = null
    for (let i = 0; i < 5 && manifest === null; i++) {
      const replies = await bus.requestMany(
        'abc.discover',
        {},
        {
          maxWaitMs: 800,
          tenant: 'global',
        },
      )
      for (const env of replies) {
        const p = ExtensionManifestSchema.safeParse(env.payload)
        if (p.success && p.data.id === EXT_ID) manifest = p.data
      }
    }

    expect(manifest).not.toBeNull()
    const names = (manifest?.tools ?? []).map(t => t.name).sort()
    expect(names).toEqual(EXPECTED_TOOLS)

    // Every tool gates on worker-url + worker-token.
    for (const t of manifest?.tools ?? []) {
      expect(t.required_config, t.name).toEqual(WORKER_REQUIRED)
    }
    const config = (manifest?.config ?? []).map(c => c.name).sort()
    expect(config).toEqual([CONFIG.workerUrl, CONFIG.workerToken].sort())
  })

  it('disables a tool call until worker-url/token are configured', async () => {
    const server = await start({ storage: 'memory' })
    const url = `nats://127.0.0.1:${server.port}`
    stops.push(() => server.stop())

    const bus = await connectNatsBus(url)
    stops.push(() => bus.close())
    const ext = new Extension(
      bus,
      createWorkerConfig(bus, {
        getConfig: () => undefined,
        makeClient: stubClient,
      }),
    )
    await ext.serve()
    stops.push(() => ext.close())

    const agent = await Agent.connect({ url })
    stops.push(() => agent.close())

    const res = await agent.callTool('global', '', EXT_ID, 'info', 'call-1', {})
    expect('error' in res && res.error).toBeTruthy()
  })
})
