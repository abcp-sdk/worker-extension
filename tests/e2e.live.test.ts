import { afterAll, describe, expect, it } from 'vitest'
import { Agent, connectNatsBus, Extension } from '@abc-protocol/sdk'
import { createWorkerConfig } from '../src/index.js'
import { CONFIG } from '../src/config.js'

/**
 * Live end-to-end against a REAL easyworker over a REAL NATS broker. Set:
 *   LIVE_NATS_URL  e.g. nats://<nats>:4222
 *   WORKER_URL     e.g. http://<easyworker>
 *   WORKER_TOKEN   the worker's bearer token
 * Skipped when unset (so `npm test` stays hermetic).
 */
const LIVE_NATS = process.env['LIVE_NATS_URL'] ?? ''
const WORKER_URL = process.env['WORKER_URL'] ?? ''
const WORKER_TOKEN = process.env['WORKER_TOKEN'] ?? ''
const maybe = LIVE_NATS === '' || WORKER_URL === '' ? describe.skip : describe

maybe('live e2e: worker extension against a real easyworker', () => {
  const stops: Array<() => Promise<void>> = []
  afterAll(async () => {
    for (const s of stops) {
      await Promise.race([
        Promise.resolve(s()).catch(() => {}),
        new Promise<void>(r => setTimeout(r, 2000)),
      ])
    }
  }, 60_000)

  it('executes commands and manipulates files through worker.v1', async () => {
    const bus = await connectNatsBus(LIVE_NATS)
    stops.push(() => bus.close())

    let ext: Extension | undefined
    const config = createWorkerConfig(bus, {
      getConfig: (name, sessionName, tenant) =>
        ext?.getConfig(name, sessionName, tenant ?? ''),
    })
    ext = new Extension(bus, config)
    await ext.serve()
    stops.push(() => ext!.close())

    const agent = await Agent.connect({ url: LIVE_NATS })
    stops.push(() => agent.close())
    await agent.serveConfig()
    const manifests = await agent.discover(1500)
    expect(manifests.find(m => m.id === 'worker')).toBeTruthy()

    const tenant = 'e2e'
    const session = 'e2e-session'
    await agent.setConfig(tenant, 'worker', CONFIG.workerUrl, WORKER_URL)
    await agent.setConfig(tenant, 'worker', CONFIG.workerToken, WORKER_TOKEN)
    await new Promise(r => setTimeout(r, 800))

    const call = async (tool: string, args: Record<string, unknown>) => {
      const res = await agent.callTool(tenant, session, 'worker', tool, `call-${tool}-${Date.now()}`, args)
      if (res.error) throw new Error(`${tool}: ${res.error.code}: ${res.error.message}`)
      return res
    }

    const info = await call('info', {})
    expect(info.data).toMatchObject({ os: 'linux', arch: 'amd64' })

    const exec = await call('exec', { command: 'echo hello-worker && printf "l1\\nl2\\n"' })
    expect(exec.content).toContain('hello-worker')
    expect(exec.data).toMatchObject({ state: 'done', exit_code: 0 })

    await call('write', { path: 'e2e/data.txt', content: 'alpha\nbeta\ngamma\n' })
    const read = await call('read', { path: 'e2e/data.txt' })
    expect(read.content).toContain('1  alpha')
    expect(read.content).toContain('3  gamma')

    const edited = await call('edit', {
      path: 'e2e/data.txt', 'start-line': 2, 'end-line': 2, content: 'BETA',
    })
    expect(edited.content).toContain('@@')
    expect(edited.content).toContain('-beta')
    expect(edited.content).toContain('+BETA')

    // Second edit without re-read is refused.
    const stale = await agent
      .callTool(tenant, session, 'worker', 'edit', `call-stale-${Date.now()}`, {
        path: 'e2e/data.txt', 'start-line': 2, 'end-line': 2, content: 'Z',
      })
      .then(r => r.error)
    expect(stale?.code).toBe('permission_denied')

    const list = await call('list', { path: 'e2e', depth: 2 })
    expect(list.content).toContain('e2e/data.txt')

    // Job lifecycle.
    const started = await call('job-start', {
      command: 'for i in $(seq 1 100); do echo tick-$i; sleep 0.2; done',
    })
    const jobId = String((started.data as Record<string, unknown>)['job-id'])
    await new Promise(r => setTimeout(r, 800))
    const out = await call('job-output', { 'job-id': jobId })
    expect(out.content).toContain('tick-')
    await call('job-kill', { 'job-id': jobId })
    const waited = await call('job-wait', { 'job-id': jobId, timeout: 5 })
    expect(['killed', 'failed', 'done']).toContain((waited.data as Record<string, unknown>).state)
  }, 120_000)
})
