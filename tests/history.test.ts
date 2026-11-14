/**
 * Tests of the per-session enhancement history store: newest-first order, the
 * per-session cap, and the least-recently-written session eviction — the three
 * rules that keep a long-lived page from accumulating unbounded text.
 * @module tests/history
 */

import { describe, expect, it } from 'vitest'
import { createHistoryStore } from '../src/client/history'

describe('createHistoryStore', () => {
  it('returns entries newest-first and gives each a fresh id', () => {
    const store = createHistoryStore()
    const first = store.record('s1', { original: 'a', result: 'A' })
    const second = store.record('s1', { original: 'b', result: 'B' })
    expect(second.id).toBeGreaterThan(first.id)
    expect(store.list('s1').map((e) => e.result)).toEqual(['B', 'A'])
  })

  it('keeps the session and time on every entry', () => {
    const store = createHistoryStore()
    const before = Date.now()
    const entry = store.record('s1', { original: 'a', result: 'A' })
    expect(entry.original).toBe('a')
    expect(entry.at).toBeGreaterThanOrEqual(before)
    expect(entry.at).toBeLessThanOrEqual(Date.now())
  })

  it('omits mode/template on the default path and keeps them otherwise', () => {
    const store = createHistoryStore()
    const plain = store.record('s1', { original: 'a', result: 'A' })
    expect(plain).not.toHaveProperty('mode')
    expect(plain).not.toHaveProperty('template')
    const framed = store.record('s1', { original: 'b', result: 'B', mode: 'spec', template: 'api-doc' })
    expect(framed.mode).toBe('spec')
    expect(framed.template).toBe('api-doc')
  })

  it('caps one session and drops its oldest entry', () => {
    const store = createHistoryStore(3)
    for (let i = 1; i <= 4; i += 1) store.record('s1', { original: `o${i}`, result: `r${i}` })
    expect(store.list('s1').map((e) => e.result)).toEqual(['r4', 'r3', 'r2'])
  })

  it('scopes entries per session', () => {
    const store = createHistoryStore()
    store.record('s1', { original: 'a', result: 'A' })
    store.record('s2', { original: 'b', result: 'B' })
    expect(store.list('s1').map((e) => e.result)).toEqual(['A'])
    expect(store.list('s2').map((e) => e.result)).toEqual(['B'])
    expect(store.list('s3')).toEqual([])
  })

  it('evicts the least-recently-written session first', () => {
    const store = createHistoryStore(10, 2)
    store.record('s1', { original: 'a', result: 'A' })
    store.record('s2', { original: 'b', result: 'B' })
    // 再写 s1：它成为最近写过的会话，下一次淘汰应该落在 s2 头上。
    store.record('s1', { original: 'c', result: 'C' })
    store.record('s3', { original: 'd', result: 'D' })
    expect(store.list('s2')).toEqual([])
    expect(store.list('s1').map((e) => e.result)).toEqual(['C', 'A'])
    expect(store.list('s3').map((e) => e.result)).toEqual(['D'])
  })

  it('forgets exactly one session on clear', () => {
    const store = createHistoryStore()
    store.record('s1', { original: 'a', result: 'A' })
    store.record('s2', { original: 'b', result: 'B' })
    store.clear('s1')
    expect(store.list('s1')).toEqual([])
    expect(store.list('s2').map((e) => e.result)).toEqual(['B'])
  })
})
