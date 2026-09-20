import type { Client, Interceptor } from '@connectrpc/connect'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-node'
import { WorkerService } from './gen/worker/v1/worker_pb.js'

/** A worker.v1 Connect client. */
export type WorkerClient = Client<typeof WorkerService>

/** The address + credential an operation runs against. */
export interface WorkerEndpoint {
  /** Base URL of an easyworker, e.g. `http://127.0.0.1:9090`. */
  url: string
  /** Worker bearer token (empty only when the worker runs with auth off). */
  token: string
}

/** Attach `Authorization: Bearer <token>` to every unary + streaming call. */
export function bearerInterceptor(token: string): Interceptor {
  return next => async req => {
    if (token !== '') req.header.set('Authorization', `Bearer ${token}`)
    return next(req)
  }
}

/** Trim trailing slashes so `baseUrl` never ends in `/`. */
export function normalizeUrl(raw: string): string {
  let s = raw.trim()
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

/** Build a bearer-authenticated worker client (h1, matching easyworker). */
export function createWorkerClient(ep: WorkerEndpoint): WorkerClient {
  const transport = createConnectTransport({
    baseUrl: normalizeUrl(ep.url),
    httpVersion: '1.1',
    interceptors: [bearerInterceptor(ep.token)],
  })
  return createClient(WorkerService, transport)
}

/**
 * Client cache keyed by `(url, token)`. Rebuilt when either changes; capped
 * (LRU) so a misconfigured URL cannot grow the map without bound.
 */
export class WorkerClientCache {
  private readonly clients = new Map<string, WorkerClient>()

  constructor(private readonly max = 16) {}

  get(ep: WorkerEndpoint): WorkerClient {
    const url = normalizeUrl(ep.url)
    const key = `${url}\u0000${ep.token}`
    const hit = this.clients.get(key)
    if (hit !== undefined) {
      this.clients.delete(key) // refresh LRU order
      this.clients.set(key, hit)
      return hit
    }
    const client = createWorkerClient({ url, token: ep.token })
    this.clients.set(key, client)
    if (this.clients.size > this.max) {
      const oldest = this.clients.keys().next().value
      if (oldest !== undefined) this.clients.delete(oldest)
    }
    return client
  }

  clear(): void {
    this.clients.clear()
  }
}
