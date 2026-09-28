import { describe, expect, it } from 'vitest'
import {
  parseSandboxes,
  sandboxConfig,
  sandboxList,
  sandboxNames,
} from '../src/config.js'

const get =
  (m: Record<string, string>) =>
  (name: string): unknown =>
    m[name]

describe('parseSandboxes', () => {
  it('parses a valid list and drops invalid entries', () => {
    const list = parseSandboxes(
      JSON.stringify([
        { name: 'a', url: 'http://a:80', token: 't1' },
        { name: '', url: 'http://b:80' },
        { name: 'c', url: '' },
        { name: 'd', url: 'http://d:80' },
      ]),
    )
    expect(list.map(s => s.name)).toEqual(['a', 'd'])
  })

  it('returns [] for empty or malformed input', () => {
    expect(parseSandboxes('')).toEqual([])
    expect(parseSandboxes('nope')).toEqual([])
    expect(parseSandboxes('{"a":1}')).toEqual([])
  })
})

describe('sandboxConfig', () => {
  const multi = get({
    sandboxes: JSON.stringify([
      { name: 'one', url: 'http://one:80', token: 'ot' },
      { name: 'two', url: 'http://two:80', token: 'tt' },
    ]),
  })

  it('defaults to the first sandbox when no name is given', () => {
    expect(sandboxConfig(multi, '', 't', 'en')).toMatchObject({
      name: 'one',
      url: 'http://one:80',
      token: 'ot',
    })
  })

  it('selects by name', () => {
    expect(sandboxConfig(multi, '', 't', 'en', 'two')).toMatchObject({
      name: 'two',
      url: 'http://two:80',
    })
  })

  it('errors on an unknown name, listing the known ones', () => {
    expect(() => sandboxConfig(multi, '', 't', 'en', 'x')).toThrow(/one, two/)
  })

  it('errors when nothing is configured', () => {
    expect(() => sandboxConfig(get({}), '', 't', 'en')).toThrow(/sandboxes/)
  })
})

describe('sandboxNames', () => {
  it('lists configured names (empty when unset)', () => {
    expect(
      sandboxNames(
        get({ sandboxes: JSON.stringify([{ name: 'a', url: 'u' }]) }),
        '',
        't',
      ),
    ).toEqual(['a'])
    expect(sandboxNames(get({}), '', 't')).toEqual([])
  })
})

describe('sandboxList', () => {
  it('returns full endpoints in config order (empty when unset)', () => {
    const g = get({
      sandboxes: JSON.stringify([
        { name: 'a', url: 'http://a:80', token: 'ta' },
        { name: 'b', url: 'http://b:80', token: 'tb' },
      ]),
    })
    expect(sandboxList(g, '', 't')).toEqual([
      { name: 'a', url: 'http://a:80', token: 'ta' },
      { name: 'b', url: 'http://b:80', token: 'tb' },
    ])
    expect(sandboxList(get({}), '', 't')).toEqual([])
  })
})
