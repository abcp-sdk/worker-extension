import { TypedToolError } from '@abc-protocol/sdk'
import { describe, expect, it } from 'vitest'
import type { WorkerClient } from '../src/client.js'
import {
  copyFile,
  deleteFile,
  editFile,
  type FileCtx,
  moveFile,
  readFile,
  uploadFile,
  writeFile,
} from '../src/tools/files.js'
import {
  checkAnchor,
  expandTilde,
  joinFileLines,
  looksTextual,
  numberLines,
  splitLines,
  toFileLines,
  windowLines,
} from '../src/tools/text.js'

const enc = (s: string) => new TextEncoder().encode(s)

/** A fake worker exposing only the file calls the file tools use. */
function fakeClient(files: Record<string, Uint8Array>): WorkerClient {
  return {
    fileRead: async (req: {
      path: string
      startLine?: number
      endLine?: number
    }) => {
      const c = files[req.path]
      if (c === undefined) throw new Error(`not found: ${req.path}`)
      const start = req.startLine ?? 0
      const end = req.endLine ?? 0
      if (start === 0 && end === 0) {
        return { content: c, totalLines: splitLines(decode(c)).length }
      }
      // Mirror the worker's line window: split on \n, join the slice with \n.
      const all = splitLines(decode(c))
      const s = Math.max(0, Math.min(start, all.length))
      const e = end <= 0 || end > all.length ? all.length : Math.max(s, end)
      const window = all.slice(s, e)
      return {
        content: enc(window.join('\n')),
        totalLines: all.length,
        startLine: s,
        endLine: e,
      }
    },
    fileWrite: async (req: { path: string; content: Uint8Array }) => {
      files[req.path] = req.content
      return { ok: true }
    },
  } as unknown as WorkerClient
}

const decode = (b: Uint8Array) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(b)

function fileCtx(
  files: Record<string, Uint8Array>,
  ingest?: (name: string, data: Uint8Array) => { code: string; mime: string },
): FileCtx {
  return {
    client: fakeClient(files),
    tenant: 't1',
    session: 's1',
    deps: {
      getFile: async () => ({ data: enc('x'), name: 'x', mime: 'text/plain' }),
      ingestFile: async ({ name, data }) =>
        ingest?.(name, data) ?? { code: 'abc123', mime: 'text/plain' },
      getSessionVariable: async () => '',
    },
  }
}

describe('text helpers', () => {
  it('detects text vs binary', () => {
    expect(looksTextual(enc('hello'))).toBe(true)
    expect(looksTextual(new Uint8Array([0, 1, 2]))).toBe(false)
    expect(looksTextual(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(false)
  })

  it('splits lines and drops a single trailing empty', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\r\nb')).toEqual(['a', 'b'])
  })

  it('windows lines with clamping', () => {
    const data = enc('l0\nl1\nl2\nl3')
    expect(windowLines(data, 1, 2).lines).toEqual(['l1', 'l2'])
    expect(windowLines(data, 1, 2).truncated).toBe(true)
    expect(windowLines(data, 10, 2).lines).toEqual([])
  })

  it('numbers lines from an absolute start', () => {
    expect(numberLines(['x', 'y'], 10)).toEqual(['10  x', '11  y'])
  })

  it('round-trips CRLF and BOM through toFileLines/joinFileLines', () => {
    const lf = toFileLines('a\nb\n')
    expect(lf.eol).toBe('\n')
    expect(lf.bom).toBe(false)
    expect(joinFileLines(lf)).toBe('a\nb\n')

    const crlf = toFileLines('a\r\nb\r\n')
    expect(crlf.eol).toBe('\r\n')
    expect(crlf.lines).toEqual(['a', 'b'])
    expect(joinFileLines(crlf)).toBe('a\r\nb\r\n')

    const bom = toFileLines('\uFEFFa\nb')
    expect(bom.bom).toBe(true)
    expect(bom.lines).toEqual(['a', 'b'])
    expect(joinFileLines(bom)).toBe('\uFEFFa\nb')

    expect(joinFileLines(toFileLines('\uFEFFa\r\nb\r\n'))).toBe(
      '\uFEFFa\r\nb\r\n',
    )
  })

  it('drops a BOM from splitLines so line numbers stay aligned', () => {
    expect(splitLines('\uFEFFfirst\nsecond')).toEqual(['first', 'second'])
  })

  it('validates anchors, treating a blank line as an empty anchor', () => {
    const lines = ['alpha', '', 'beta'] // line 2 is blank
    // blank line + "" is a match (the bug fix)
    expect(checkAnchor(lines, 2, '', 3)).toEqual({ ok: true })
    // blank line + non-empty text is a mismatch
    expect(checkAnchor(lines, 2, 'x', 3)).toEqual({
      ok: false,
      reason: 'mismatch',
      actual: '',
      expected: 'x',
    })
    // non-blank line + "" is a mismatch (expected empty)
    expect(checkAnchor(lines, 1, '', 3)).toEqual({
      ok: false,
      reason: 'mismatch',
      actual: 'alpha',
      expected: '',
    })
    // correct text matches; whitespace-only differences are tolerated
    expect(checkAnchor(lines, 1, '  alpha  ', 3)).toEqual({ ok: true })
    // non-existent boundary requires ""
    expect(checkAnchor(lines, 0, '', 3)).toEqual({ ok: true })
    expect(checkAnchor(lines, 0, 'x', 3)).toEqual({
      ok: false,
      reason: 'outOfRange',
    })
  })

  it('expands a leading ~ against home (falls back to workspace)', () => {
    const a = { home: '/root', workspace: '/root/workspace' }
    expect(expandTilde('~', a)).toBe('/root')
    expect(expandTilde('~/', a)).toBe('/root')
    expect(expandTilde('~/x/y', a)).toBe('/root/x/y')
    expect(expandTilde('/abs/x', a)).toBe('/abs/x')
    expect(expandTilde('rel/x', a)).toBe('rel/x')
    expect(expandTilde('~bob/x', a)).toBe('~bob/x')
    expect(expandTilde('~/x', { home: '', workspace: '/ws' })).toBe('/ws/x')
    expect(expandTilde('~/x', { home: '', workspace: '' })).toBe('~/x')
  })
})

describe('read', () => {
  it('returns numbered lines and a truncation marker', async () => {
    const files = { 'a.txt': enc('one\ntwo\nthree\nfour') }
    const r = await readFile(fileCtx(files), {
      path: 'a.txt',
      offset: 1,
      limit: 2,
    })
    expect(r.content).toContain('2  two')
    expect(r.content).toContain('3  three')
    expect(r.content).toContain('showing lines 2-3 of 4')
  })

  it('rejects binary files with a typed invalid_argument error', async () => {
    const files = { 'a.bin': new Uint8Array([0, 1, 2, 3]) }
    const err = await readFile(fileCtx(files), { path: 'a.bin' }).catch(e => e)
    expect(err).toBeInstanceOf(TypedToolError)
    expect((err as TypedToolError).code).toBe('invalid_argument')
    expect(String(err)).toMatch(/not a text file/)
  })

  it('missing required args are typed invalid_argument', async () => {
    const err = await readFile(fileCtx({}), {}).catch(e => e)
    expect(err).toBeInstanceOf(TypedToolError)
    expect((err as TypedToolError).code).toBe('invalid_argument')
  })

  it('fetches the window SERVER-SIDE (only the window bytes cross the wire)', async () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line-${i}`).join('\n')
    const files = { 'big.txt': enc(big) }
    let seenReq: { startLine?: number; endLine?: number } | null = null
    const ctx = fileCtx(files)
    const orig = ctx.client.fileRead
    ;(ctx.client as unknown as { fileRead: typeof orig }).fileRead =
      (async (req: { path: string; startLine?: number; endLine?: number }) => {
        seenReq = { startLine: req.startLine, endLine: req.endLine }
        return orig(req as never)
      }) as typeof orig
    const r = await readFile(ctx, { path: 'big.txt', offset: 100, limit: 200 })
    // The worker was asked for exactly [100, 300), not the whole 5000 lines.
    expect(seenReq).toEqual({ startLine: 100, endLine: 300 })
    expect(r.content).toContain('101  line-100')
    expect(r.content).toContain('showing lines 101-300 of 5000')
  })
})

describe('delete / move / copy', () => {
  function fsClient(files: Record<string, Uint8Array>): WorkerClient {
    const dirs = new Set<string>()
    return {
      fileDelete: async (req: { path: string }) => {
        delete files[req.path]
        return { ok: true }
      },
      fileMove: async (req: { from: string; to: string }) => {
        if (files[req.from] === undefined) throw new Error('missing')
        files[req.to] = files[req.from]!
        delete files[req.from]
        return { ok: true }
      },
      fileCopy: async (req: { from: string; to: string }) => {
        if (files[req.from] === undefined) throw new Error('missing')
        files[req.to] = files[req.from]!
        return { ok: true }
      },
    } as unknown as WorkerClient
  }

  it('delete removes the path and reports it', async () => {
    const files = { 'a.txt': enc('x') }
    const ctx = fileCtx(files)
    ;(ctx as { client: WorkerClient }).client = fsClient(files)
    const r = await deleteFile(ctx, { path: 'a.txt' })
    expect(r.content).toContain("deleted 'a.txt'")
    expect(files['a.txt']).toBeUndefined()
  })

  it('move renames and reports from/to', async () => {
    const files = { 'a.txt': enc('x') }
    const ctx = fileCtx(files)
    ;(ctx as { client: WorkerClient }).client = fsClient(files)
    const r = await moveFile(ctx, { from: 'a.txt', to: 'b.txt' })
    expect(r.content).toContain("moved 'a.txt' to 'b.txt'")
    expect(files['b.txt']).toBeDefined()
    expect(files['a.txt']).toBeUndefined()
  })

  it('copy duplicates and reports from/to', async () => {
    const files = { 'a.txt': enc('x') }
    const ctx = fileCtx(files)
    ;(ctx as { client: WorkerClient }).client = fsClient(files)
    const r = await copyFile(ctx, { from: 'a.txt', to: 'b.txt' })
    expect(r.content).toContain("copied 'a.txt' to 'b.txt'")
    expect(files['a.txt']).toBeDefined()
    expect(files['b.txt']).toBeDefined()
  })

  it('missing args are typed invalid_argument', async () => {
    const ctx = fileCtx({})
    ;(ctx as { client: WorkerClient }).client = fsClient({})
    const err = await deleteFile(ctx, {}).catch(e => e)
    expect(err).toBeInstanceOf(TypedToolError)
    expect((err as TypedToolError).code).toBe('invalid_argument')
  })
})

describe('write', () => {
  it('writes bytes and returns the numbered full file', async () => {
    const files: Record<string, Uint8Array> = {}
    const r = await writeFile(fileCtx(files), {
      path: 'out.txt',
      content: 'a\nb\n',
    })
    expect(new TextDecoder().decode(files['out.txt'])).toBe('a\nb\n')
    expect(r.content).toContain('Wrote 4 bytes')
    expect(r.content).toContain('1  a')
    expect(r.content).toContain('2  b')
    expect(r.data).toMatchObject({ lines: 2, total_lines: 2 })
  })

  it('does not cap at 1000 lines (whole file returned)', async () => {
    const files: Record<string, Uint8Array> = {}
    const body =
      Array.from({ length: 1200 }, (_, i) => `L${i + 1}`).join('\n') + '\n'
    const r = await writeFile(fileCtx(files), {
      path: 'big.txt',
      content: body,
    })
    expect(r.content).toContain('1200  L1200')
    expect(r.content).not.toContain('truncated')
  })

  it('rejects content over 120 KiB without writing', async () => {
    const files: Record<string, Uint8Array> = {}
    const huge = 'x'.repeat(121 * 1024)
    const err = await writeFile(fileCtx(files), {
      path: 'huge.txt',
      content: huge,
    }).catch(e => e)
    expect(err).toBeInstanceOf(TypedToolError)
    expect((err as TypedToolError).code).toBe('invalid_argument')
    expect(files['huge.txt']).toBeUndefined()
  })
})

describe('edit (anchor lines + anchor content)', () => {
  const decode = (f: Record<string, Uint8Array>) =>
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(f['a.txt'])

  it('replaces the lines strictly between the two anchors', async () => {
    const files = { 'a.txt': enc('1\n2\n3\n4') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 4,
      'start-anchor': '1',
      'end-anchor': '4',
      content: 'X',
    })
    expect(decode(files)).toBe('1\nX\n4')
  })

  it('inserts between two adjacent anchors (27/28 style)', async () => {
    const files = { 'a.txt': enc('1\n2\n3') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 2,
      'start-anchor': '1',
      'end-anchor': '2',
      content: 'X',
    })
    expect(decode(files)).toBe('1\nX\n2\n3')
  })

  it('prepends at the head with start-anchor-line 0 (empty start-anchor)', async () => {
    const files = { 'a.txt': enc('1\n2\n3') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 0,
      'end-anchor-line': 1,
      'start-anchor': '',
      'end-anchor': '1',
      content: 'HEAD',
    })
    expect(decode(files)).toBe('HEAD\n1\n2\n3')
  })

  it('accepts an empty string as the head sentinel line', async () => {
    const files = { 'a.txt': enc('1\n2') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': '',
      'end-anchor-line': 1,
      'start-anchor': '',
      'end-anchor': '1',
      content: 'HEAD',
    })
    expect(decode(files)).toBe('HEAD\n1\n2')
  })

  it('appends at the tail with end-anchor-line total+1 (empty end-anchor)', async () => {
    const files = { 'a.txt': enc('1\n2\n3') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 3,
      'end-anchor-line': 4,
      'start-anchor': '3',
      'end-anchor': '',
      content: 'TAIL',
    })
    expect(decode(files)).toBe('1\n2\n3\nTAIL')
  })

  it('accepts an empty string as the tail sentinel line', async () => {
    const files = { 'a.txt': enc('1\n2') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 2,
      'end-anchor-line': '',
      'start-anchor': '2',
      'end-anchor': '',
      content: 'TAIL',
    })
    expect(decode(files)).toBe('1\n2\nTAIL')
  })

  it('inserts into an empty file (start 0, end 1, both anchors empty)', async () => {
    const files: Record<string, Uint8Array> = {}
    const ctx = fileCtx(files)
    await writeFile(ctx, { path: 'a.txt', content: '' })
    await editFile(ctx, {
      path: 'a.txt',
      'start-anchor-line': 0,
      'end-anchor-line': 1,
      'start-anchor': '',
      'end-anchor': '',
      content: 'first',
    })
    expect(decode(files)).toBe('first')
  })

  it('deletes the region when content is empty', async () => {
    const files = { 'a.txt': enc('1\n2\n3\n4') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 4,
      'start-anchor': '1',
      'end-anchor': '4',
      content: '',
    })
    expect(decode(files)).toBe('1\n4')
  })

  it('preserves the trailing newline', async () => {
    const files = { 'a.txt': enc('alpha\nbeta\ngamma\n') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 3,
      'start-anchor': 'alpha',
      'end-anchor': 'gamma',
      content: 'BETA',
    })
    expect(decode(files)).toBe('alpha\nBETA\ngamma\n')
  })

  it('preserves CRLF line endings across an edit', async () => {
    const files = { 'a.txt': enc('alpha\r\nbeta\r\ngamma\r\n') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 3,
      'start-anchor': 'alpha',
      'end-anchor': 'gamma',
      content: 'BETA',
    })
    expect(decode(files)).toBe('alpha\r\nBETA\r\ngamma\r\n')
  })

  it('preserves a UTF-8 BOM across an edit', async () => {
    const files = { 'a.txt': enc('\uFEFFalpha\nbeta\ngamma\n') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 3,
      'start-anchor': 'alpha',
      'end-anchor': 'gamma',
      content: 'BETA',
    })
    expect(decode(files)).toBe('\uFEFFalpha\nBETA\ngamma\n')
  })

  it('preserves CRLF + BOM together', async () => {
    const files = { 'a.txt': enc('\uFEFFalpha\r\nbeta\r\ngamma\r\n') }
    await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 3,
      'start-anchor': 'alpha',
      'end-anchor': 'gamma',
      content: 'BETA',
    })
    expect(decode(files)).toBe('\uFEFFalpha\r\nBETA\r\ngamma\r\n')
  })

  it('rejects an out-of-range start anchor instead of clamping', async () => {
    const ten =
      Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join('\n') + '\n'
    const files = { 'a.txt': enc(ten) }
    const err = await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 11,
      'end-anchor-line': 11,
      'start-anchor': '',
      'end-anchor': '',
      content: 'XXX',
    }).catch(e => e)
    expect(err).toBeInstanceOf(TypedToolError)
    expect((err as TypedToolError).code).toBe('invalid_argument')
    expect(decode(files)).toBe(ten)
  })

  it('rejects an out-of-range end anchor', async () => {
    const files = { 'a.txt': enc('1\n2\n3\n') }
    const err = await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 5,
      'start-anchor': '1',
      'end-anchor': '',
      content: 'X',
    }).catch(e => e)
    expect((err as TypedToolError).code).toBe('invalid_argument')
  })

  it('rejects an inverted anchor pair (end <= start)', async () => {
    const files = { 'a.txt': enc('1\n2\n3\n') }
    const err = await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 2,
      'end-anchor-line': 2,
      'start-anchor': '',
      'end-anchor': '',
      content: 'X',
    }).catch(e => e)
    expect((err as TypedToolError).code).toBe('invalid_argument')
  })

  it('requires all four anchor arguments', async () => {
    const files = { 'a.txt': enc('1\n2\n3\n') }
    for (const missing of [
      'start-anchor-line',
      'end-anchor-line',
      'start-anchor',
      'end-anchor',
    ]) {
      const args: Record<string, unknown> = {
        path: 'a.txt',
        'start-anchor-line': 1,
        'end-anchor-line': 3,
        'start-anchor': '1',
        'end-anchor': '3',
        content: 'X',
      }
      delete args[missing]
      const err = await editFile(fileCtx(files), args).catch(e => e)
      expect(err).toBeInstanceOf(TypedToolError)
      expect((err as TypedToolError).code).toBe('invalid_argument')
      expect(String(err)).toContain(missing)
    }
    expect(decode(files)).toBe('1\n2\n3\n')
  })

  it('refuses the edit when an anchor content does not match (no write)', async () => {
    const files = { 'a.txt': enc('alpha\nbeta\ngamma\n') }
    const err = await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 3,
      'start-anchor': 'WRONG',
      'end-anchor': 'gamma',
      content: 'X',
    }).catch(e => e)
    expect((err as TypedToolError).code).toBe('retryable')
    expect(decode(files)).toBe('alpha\nbeta\ngamma\n')
  })

  it('refuses the edit when a non-blank anchor line is given an empty anchor', async () => {
    const files = { 'a.txt': enc('alpha\nbeta\n') }
    const err = await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 3,
      'start-anchor': '',
      'end-anchor': '',
      content: 'X',
    }).catch(e => e)
    expect((err as TypedToolError).code).toBe('retryable')
  })

  it('accepts an empty anchor when the anchor line itself is blank', async () => {
    // line 2 is a blank line; editing line 3 anchors on lines 2 (blank) and 4 (tail).
    const files = { 'a.txt': enc('alpha\n\nbeta\n') }
    const r = await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 2,
      'end-anchor-line': 4,
      'start-anchor': '',
      'end-anchor': '',
      content: 'BETA',
    })
    expect(String(r.content)).toContain('Edited')
    expect(decode(files)).toBe('alpha\n\nBETA\n')
  })

  it('refuses a non-empty anchor at a boundary line that does not exist', async () => {
    const files = { 'a.txt': enc('1\n2\n') }
    const err = await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 0,
      'end-anchor-line': 1,
      'start-anchor': 'nope',
      'end-anchor': '1',
      content: 'X',
    }).catch(e => e)
    expect((err as TypedToolError).code).toBe('retryable')
  })

  it('returns a unified diff in content', async () => {
    const files = { 'a.txt': enc('1\n2\n3\n4') }
    const r = await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 4,
      'start-anchor': '1',
      'end-anchor': '4',
      content: 'X',
    })
    expect(r.content).toContain('--- a/a.txt')
    expect(r.content).toContain('+++ b/a.txt')
    expect(r.content).toContain('-2')
    expect(r.content).toContain('-3')
    expect(r.content).toContain('+X')
    expect(r.data).toMatchObject({ added: 1, removed: 2 })
  })

  it('reports no changes when the edit is a no-op', async () => {
    const files = { 'a.txt': enc('1\n2\n3\n') }
    const r = await editFile(fileCtx(files), {
      path: 'a.txt',
      'start-anchor-line': 1,
      'end-anchor-line': 3,
      'start-anchor': '1',
      'end-anchor': '3',
      content: '2',
    })
    expect(String(r.content)).toContain('No changes')
  })
})

describe('upload', () => {
  it('routes bytes through ingest with a default name', async () => {
    const files = { 'dir/a.txt': enc('data') }
    let seen: { name: string; len: number } | undefined
    await uploadFile(
      fileCtx(files, (name, data) => {
        seen = { name, len: data.length }
        return { code: 'c0de', mime: 'text/plain' }
      }),
      { path: 'dir/a.txt' },
    )
    expect(seen).toEqual({ name: 'a.txt', len: 4 })
  })
})
