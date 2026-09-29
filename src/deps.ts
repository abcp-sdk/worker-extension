import type { Bus } from '@abc-protocol/sdk'
import {
  getFileViaAgent,
  ingestFileViaAgent,
  sessionVarKey,
  TypedToolError,
  VARS_BUCKET,
} from '@abc-protocol/sdk'
import { tr } from './i18n.js'

/**
 * Host hooks backed by the agent's file RPCs. The extension owns no blob
 * backend: it routes bytes through the agent, which persists them and (for
 * ingest) DERIVES the content type from the bytes — callers send no mime.
 */
export interface WorkerDeps {
  /** Persist bytes through the agent and return the canonical `file:<code>`
   *  plus the agent-derived mime. */
  ingestFile: (input: {
    name: string
    data: Uint8Array
    session?: string
    tenant?: string
  }) => Promise<{ code: string; mime: string }>
  /** Fetch stored bytes through the agent (used by `download`). */
  getFile: (
    code: string,
    tenant?: string,
  ) => Promise<{ data: Uint8Array; name: string; mime: string }>
  /**
   * Read a session variable the agent projects (vars bucket, provider "agent"),
   * e.g. `locale`. Returns '' when unset. Used to localize tool results.
   */
  getSessionVariable: (
    tenant: string,
    provider: string,
    sessionName: string,
    name: string,
  ) => Promise<string>
}

function requireTenant(tenant: string | undefined, op: string): string {
  if (tenant === undefined || tenant === '') {
    // Defensive: the tenant always rides the protocol envelope, so this only
    // fires on host misconfiguration. Typed internal, text from the catalog.
    throw new TypedToolError('internal', tr('en', 'tenantRequired', { op }))
  }
  return tenant
}

/** Default deps backed by the agent file RPCs (`abc.<tenant>.file.*`). */
export function agentFileDeps(bus: Bus): WorkerDeps {
  return {
    ingestFile: async ({ name, data, session, tenant }) => {
      const t = requireTenant(tenant, 'ingestFile')
      const { code, mime } = await ingestFileViaAgent(bus, t, {
        name,
        data,
        ...(session !== undefined && session !== ''
          ? { sessionName: session }
          : {}),
      })
      return { code, mime }
    },
    getFile: async (code, tenant) => {
      const t = requireTenant(tenant, 'getFile')
      const got = await getFileViaAgent(bus, t, code)
      if (got === null) {
        throw new TypedToolError(
          'not_found',
          tr('en', 'fileNotFound', { code }),
        )
      }
      return { data: got.data, name: got.meta.name, mime: got.meta.mime }
    },
    getSessionVariable: async (tenant, provider, sessionName, name) => {
      if (sessionName === '') return ''
      try {
        const v = await bus.kvGet(
          VARS_BUCKET,
          sessionVarKey(tenant, provider, sessionName, name),
        )
        return v ?? ''
      } catch {
        return ''
      }
    },
  }
}
