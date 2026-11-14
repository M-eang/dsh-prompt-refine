import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { FinishReason, StreamChunk } from '@deepseek-ai/dsh-llm'
import { DEFAULT_CONFIG } from '../src/config'
import { DEFAULT_SYSTEM_PROMPT, REWRITE_STANCE } from '../src/prompts'
import { MODE_SPECS } from '../src/shared/modes'
import { TEMPLATE_SPECS } from '../src/shared/templates'
import { EnhanceFailure, failureDimensionOf } from '../src/enhancer'
import { defaultRouteOf, gatherContext, resetWorkspaceScanCache, runEnhance, sessionRouteOf } from '../src/orchestrate'

/**
 * Minimal cordis stand-in. Cordis services are injected as CONTEXT PROPERTIES
 * (`ctx.agentDefaultModel`), not via `ctx.get`, hence the second argument —
 * a cordis-service face has to be shaped as a property to be reachable.
 */
function fakeCtx(services: Record<string, unknown>, props: Record<string, unknown> = {}): Context {
  return { get: (key: string) => services[key], ...props } as never
}

describe('route resolution helpers', () => {
  it('reads the harness default model and trims it', () => {
    const ctx = fakeCtx({ settings: { get: (ns: string) => (ns === 'agent-default-model' ? { provider: ' zhipu ', model: ' glm ' } : undefined) } })
    expect(defaultRouteOf(ctx)).toEqual({ provider: 'zhipu', model: 'glm' })
  })

  it('ignores malformed default-model sections', () => {
    expect(defaultRouteOf(fakeCtx({ settings: { get: () => ({ provider: 'x', model: '' }) } }))).toBeUndefined()
    expect(defaultRouteOf(fakeCtx({ settings: { get: () => null } }))).toBeUndefined()
    expect(defaultRouteOf(fakeCtx({}))).toBeUndefined()
  })

  // Regression (dsh >= 0.1.5-rc.3): the settings service became `SettingsForms`
  // with no synchronous `get`. Calling through the old shape threw
  // `ctx.get(...)?.get is not a function` and 502'd EVERY enhancement, because
  // this sits on every request's route-resolution path. A missing reader must
  // degrade to "no answer", never to a thrown TypeError.
  it('degrades when the settings service has no synchronous reader', () => {
    const forms = { configure: () => {}, describe: () => [], update: async () => {} }
    expect(() => defaultRouteOf(fakeCtx({ settings: forms }))).not.toThrow()
    expect(defaultRouteOf(fakeCtx({ settings: forms }))).toBeUndefined()
  })

  it('degrades when the sessions store has no reader', () => {
    expect(sessionRouteOf(fakeCtx({ sessions: { list: () => [] } }), 's1')).toBeUndefined()
  })

  // dsh >= 0.1.5-rc.3 reads the selection from `ctx.agentDefaultModel`
  // instead of the settings namespace. Both shapes must answer; neither may
  // throw, because this runs on every enhance request.
  it('reads the harness default model from agentDefaultModel', () => {
    const ctx = fakeCtx({}, { agentDefaultModel: { currentSelection: () => ({ provider: ' deepseek ', model: ' chat ' }) } })
    expect(defaultRouteOf(ctx)).toEqual({ provider: 'deepseek', model: 'chat' })
  })

  it('prefers agentDefaultModel and falls back to the legacy settings read', () => {
    const legacy = fakeCtx({ settings: { get: () => ({ provider: 'legacy-p', model: 'legacy-m' }) } })
    expect(defaultRouteOf(legacy)).toEqual({ provider: 'legacy-p', model: 'legacy-m' })

    const emptyModern = fakeCtx(
      { settings: { get: () => ({ provider: 'legacy-p', model: 'legacy-m' }) } },
      { agentDefaultModel: { currentSelection: () => undefined } },
    )
    expect(defaultRouteOf(emptyModern)).toEqual({ provider: 'legacy-p', model: 'legacy-m' })
  })

  it('survives an agentDefaultModel that throws', () => {
    const ctx = fakeCtx({}, { agentDefaultModel: { currentSelection: () => { throw new Error('boom') } } })
    expect(() => defaultRouteOf(ctx)).not.toThrow()
    expect(defaultRouteOf(ctx)).toBeUndefined()
  })

  // cordis throws `cannot get property "agentDefaultModel" without inject` for
  // any service that was not declared via `inject`, and the PROPERTY READ is
  // what throws — so guarding only the call would still 502 every request.
  it('survives reading agentDefaultModel without inject', () => {
    const ctx = {
      get: (key: string) => undefined,
      get agentDefaultModel(): never {
        throw new Error('cannot get property "agentDefaultModel" without inject')
      },
    } as never
    expect(() => defaultRouteOf(ctx)).not.toThrow()
    expect(defaultRouteOf(ctx)).toBeUndefined()
  })

  // Regression: `Session.requestHeader` is a method in both 0.1.1-rc.2 and
  // 0.1.2-alpha.3. The previous mock shaped it as a plain property, so the test
  // passed against something the runtime never produces while the real call
  // silently returned undefined.
  it('reads the session request route when a session id is given', () => {
    const ctx = fakeCtx({
      sessions: {
        get: (id: string) => (id === 's1' ? { requestHeader: () => ({ config: { provider: ' p1 ', model: ' m1 ' } }) } : undefined),
      },
    })
    expect(sessionRouteOf(ctx, 's1')).toEqual({ provider: 'p1', model: 'm1' })
    expect(sessionRouteOf(ctx, 'missing')).toBeUndefined()
    expect(sessionRouteOf(ctx, undefined)).toBeUndefined()
    expect(sessionRouteOf(ctx, '')).toBeUndefined()
  })

  it('tolerates a header method that returns nothing', () => {
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: () => undefined }) } })
    expect(sessionRouteOf(ctx, 's1')).toBeUndefined()
  })

  // Regression: a throwing `requestHeader()` (frozen session object, future
  // signature change) must degrade to the default route instead of failing
  // the whole enhance request.
  it('degrades when the header method throws', () => {
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: () => { throw new Error('boom') } }) } })
    expect(sessionRouteOf(ctx, 's1')).toBeUndefined()
  })

  it('still accepts the property shape defensively', () => {
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: { config: { provider: 'p2', model: 'm2' } } }) } })
    expect(sessionRouteOf(ctx, 's1')).toEqual({ provider: 'p2', model: 'm2' })
  })

  it('resolves nothing without a sessions service or a partial section', () => {
    expect(sessionRouteOf(fakeCtx({}), 's1')).toBeUndefined()
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: () => ({ config: { provider: 'p', model: '' } }) }) } })
    expect(sessionRouteOf(ctx, 's1')).toBeUndefined()
  })

  it('resolves nothing when the harness has no default model either', () => {
    expect(defaultRouteOf(fakeCtx({}))).toBeUndefined()
  })

  it('keeps the defaults constant in sync', () => {
    expect(DEFAULT_CONFIG.maxConcurrent).toBe(2)
    expect(DEFAULT_CONFIG.rateLimitPerMinute).toBe(10)
  })
})

describe('gatherContext', () => {
  /** One session whose derived history is a single user turn. */
  const session = {
    deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: '我们在做 DSH 插件' }] }],
    header: { cwd: 'D:\\proj' },
  }

  /** A one-file `fs` stub: the root has `README.md` only. */
  const fs = {
    resolve: async (path: string) => ({ targetKey: '', displayPath: path }),
    listDir: async () => [{ name: 'README.md', type: 'file', target: { targetKey: 'README.md', displayPath: 'README.md' } }],
    readText: async () => '# Proj\nDSH prompt plugin',
  }

  it('assembles both layers and reports the file count', async () => {
    const ctx = fakeCtx({ sessions: { get: () => session }, fs })
    const bundle = await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG }, '继续')
    expect(bundle.history).toBe(true)
    expect(bundle.workspace).toBe(true)
    expect(bundle.files).toBe(1)
    expect(bundle.block).toContain('<conversation_context>')
    expect(bundle.block).toContain('<workspace_context>')
    expect(bundle.block).toContain('README.md')
  })

  it('keeps the conversation layer when the workspace cannot be read', async () => {
    const badFs = { resolve: async () => { throw new Error('boom') }, listDir: async () => [], readText: async () => '' }
    const ctx = fakeCtx({ sessions: { get: () => session }, fs: badFs })
    const bundle = await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG }, '继续')
    expect(bundle.history).toBe(true)
    expect(bundle.workspace).toBe(false)
    expect(bundle.block).not.toContain('<workspace_context>')
  })

  it('degrades to no grounding when no service answers', async () => {
    const bundle = await gatherContext(fakeCtx({}), 's1', { ...DEFAULT_CONFIG }, '继续')
    expect(bundle).toEqual({ history: false, workspace: false, files: 0 })
  })

  it('skips both layers when their switches are off', async () => {
    const ctx = fakeCtx({ sessions: { get: () => session }, fs })
    const bundle = await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG, contextAware: false, workspaceAware: false }, '继续')
    expect(bundle).toEqual({ history: false, workspace: false, files: 0 })
  })

  it('honours a configured workspace root over the session working directory', async () => {
    let asked = ''
    const spyFs = { ...fs, resolve: async (path: string) => { asked = path; return { targetKey: '', displayPath: path } } }
    await gatherContext(fakeCtx({ sessions: { get: () => session }, fs: spyFs }), 's1', { ...DEFAULT_CONFIG, workspaceRoot: 'D:\\other' }, '继续')
    expect(asked).toBe('D:\\other')
  })
})

/**
 * The host failure-log line is the only observability an operator gets, and it
 * is the one place a provider message, a prompt or a route must never appear.
 * These tests pin both halves of that contract: the line carries a stable
 * failure dimension (`reason=`), and it stays free of the thrown text.
 */
describe('failure log dimension', () => {
  /** Run one enhancement and return the diagnostic line it wrote. */
  async function logged(run: () => Promise<unknown>): Promise<string> {
    // Diagnostics go to stderr (src/orchestrate.ts:570): under the ACP profile
    // stdout is the JSON-RPC channel, so the log line left console.info behind.
    const written: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stderr.write)
    try {
      await run().catch(() => undefined)
      return written.join('')
    } finally {
      spy.mockRestore()
    }
  }

  /** A one-chunk stream carrying just the terminal finish under test. */
  function finishStream(reason: FinishReason): AsyncIterable<StreamChunk> {
    return (async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'finish', reason }
    })()
  }

  it('names the stable upstream reason and keeps the provider message out', async () => {
    const secret = '429 quota exhausted for gateway.acme.internal'
    const llm = { stream: (): AsyncIterable<StreamChunk> => finishStream({ kind: 'error', failure: { code: 'RATE_LIMIT', message: secret } }) }
    const line = await logged(() => runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG }, { text: '帮我写个脚本', sessionRoute: { provider: 'p', model: 'm' } }))
    expect(line).toContain('error=upstream')
    expect(line).toContain('reason=rate-limit')
    expect(line).not.toContain('gateway.acme.internal')
    expect(line).not.toContain('429')
  })

  it('classifies an unexpected host-side throw by its class, not by its message', async () => {
    const llm = { stream: (): AsyncIterable<StreamChunk> => { throw new TypeError('undefined is not a function (key sk-live-do-not-log)') } }
    const line = await logged(() => runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG }, { text: '帮我写个脚本', sessionRoute: { provider: 'p', model: 'm' } }))
    expect(line).toContain('error=internal')
    expect(line).toContain('reason=TypeError')
    expect(line).not.toContain('sk-live-do-not-log')
    expect(line).not.toContain('is not a function')
  })

  it('separates a route-less host, a host without the LLM service, and a cancel', async () => {
    const routeLess = await logged(() => runEnhance(fakeCtx({}), { ...DEFAULT_CONFIG }, { text: '帮我写个脚本' }))
    expect(routeLess).toContain('error=unconfigured')
    expect(routeLess).toContain('reason=unconfigured')

    const noLlm = await logged(() => runEnhance(fakeCtx({}), { ...DEFAULT_CONFIG }, { text: '帮我写个脚本', sessionRoute: { provider: 'p', model: 'm' } }))
    expect(noLlm).toContain('error=internal')
    expect(noLlm).toContain('reason=no-llm-service')

    const controller = new AbortController()
    controller.abort()
    const cancelled = await logged(() => runEnhance(
      fakeCtx({ llm: { stream: (): AsyncIterable<StreamChunk> => finishStream({ kind: 'stop' }) } }),
      { ...DEFAULT_CONFIG },
      { text: '帮我写个脚本', sessionRoute: { provider: 'p', model: 'm' }, signal: controller.signal },
    ))
    expect(cancelled).toContain('reason=abort')
  })

  it('keeps the success line free of the failure dimension and of the rewritten text', async () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '角色：工程师' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '角色：工程师' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const llm = { stream: (): AsyncIterable<StreamChunk> => (async function* (): AsyncGenerator<StreamChunk> {
      for (const chunk of chunks) yield chunk
    })() }
    const line = await logged(() => runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG }, { text: '帮我写个脚本', sessionRoute: { provider: 'p', model: 'm' } }))
    expect(line).toContain('ok')
    expect(line).not.toContain('reason=')
    expect(line).not.toContain('truncated=1')
    expect(line).not.toContain('工程师')
  })

  it('marks a capped-but-successful call with truncated=1 on the success line', async () => {
    const llm = { stream: (): AsyncIterable<StreamChunk> => (async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '角色：工程师（被截断）' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '角色：工程师（被截断）' } }
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
    })() }
    const line = await logged(() => runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG }, { text: '帮我写个脚本', sessionRoute: { provider: 'p', model: 'm' } }))
    // Still a success — the partial rewrite is handed back, and the operator
    // can see from the log why it is short.
    expect(line).toContain('truncated=1 ok')
    expect(line).not.toContain('error=')
  })

  it('refuses to log a classifier that is not a plain identifier', () => {
    const rogue = new Error('boom')
    rogue.name = 'sk-live-abcdef SECRET: pasted provider text'
    expect(failureDimensionOf(rogue)).toBe('unexpected')
    expect(failureDimensionOf(new EnhanceFailure({ code: 'internal' }, 'a/b c'))).toBe('unexpected')
    // A well-formed class name and the closed vocabulary pass through unchanged.
    expect(failureDimensionOf(new TypeError('boom'))).toBe('TypeError')
    expect(failureDimensionOf(new EnhanceFailure({ code: 'upstream', params: { reason: 'max-tokens' } }))).toBe('max-tokens')
    expect(failureDimensionOf(new EnhanceFailure({ code: 'timeout', params: { seconds: 60 } }))).toBe('timeout')
  })
})

/**
 * The workspace scan is cached in module state, keyed on the `fs` provider, the
 * session object, the resolved root and the configured bounds — so a cache hit
 * can only ever answer the question the scan was just asked. These cases pin
 * each key component, the TTL, and the one thing the cache must never do:
 * remember a failure.
 */
describe('workspace scan cache', () => {
  /** One session whose history is empty, so only the workspace layer can answer. */
  const session = { deriveMessages: (): unknown[] => [], header: { cwd: 'D:\\proj' } }

  /** A one-file workspace face plus counters for every call it receives. */
  function countingFs(): { face: Record<string, unknown>; calls: { resolve: number; listDir: number; readText: number } } {
    const calls = { resolve: 0, listDir: 0, readText: 0 }
    return {
      calls,
      face: {
        async resolve(path: string) { calls.resolve++; return { targetKey: '', displayPath: path } },
        async listDir() {
          calls.listDir++
          return [{ name: 'README.md', type: 'file', target: { targetKey: 'README.md', displayPath: 'README.md' } }]
        },
        async readText() { calls.readText++; return '# Proj' },
      },
    }
  }

  beforeEach(() => {
    resetWorkspaceScanCache()
  })

  it('reuses one scan for the same provider, session, root and bounds', async () => {
    const { face, calls } = countingFs()
    const ctx = fakeCtx({ sessions: { get: () => session }, fs: face })
    const first = await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG }, '继续')
    const second = await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG }, '继续')
    expect(calls.resolve).toBe(1)
    expect(calls.listDir).toBe(1)
    expect(calls.readText).toBe(1)
    expect(second.block).toBe(first.block)
    expect(second.files).toBe(first.files)
  })

  it('re-scans once the entry has expired', async () => {
    const { face, calls } = countingFs()
    const ctx = fakeCtx({ sessions: { get: () => session }, fs: face })
    const start = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(start)
      await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG }, '继续')
      await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG }, '继续')
      expect(calls.resolve).toBe(1)
      // Past the TTL the stale excerpt must not be reused.
      vi.setSystemTime(start + 10_001)
      await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG }, '继续')
      expect(calls.resolve).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never remembers a failed scan', async () => {
    let attempts = 0
    const badFace = {
      async resolve(): Promise<{ targetKey: string; displayPath: string }> {
        attempts++
        throw new Error('boom')
      },
      async listDir() { return [] },
      async readText() { return '' },
    }
    const ctx = fakeCtx({ sessions: { get: () => session }, fs: badFace })
    const first = await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG }, '继续')
    const second = await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG }, '继续')
    expect(attempts).toBe(2)
    expect(first.workspace).toBe(false)
    expect(second).toEqual({ history: false, workspace: false, files: 0 })
  })

  it('keys on the provider identity', async () => {
    const a = countingFs()
    const b = countingFs()
    await gatherContext(fakeCtx({ sessions: { get: () => session }, fs: a.face }), 's1', { ...DEFAULT_CONFIG }, '继续')
    await gatherContext(fakeCtx({ sessions: { get: () => session }, fs: b.face }), 's1', { ...DEFAULT_CONFIG }, '继续')
    expect(a.calls.resolve).toBe(1)
    expect(b.calls.resolve).toBe(1)
  })

  it('keys on the session, the root and the bounds', async () => {
    const { face, calls } = countingFs()
    const ctx = fakeCtx({ sessions: { get: () => session }, fs: face })
    await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG }, '继续')
    // Same provider, different session object → a different key.
    await gatherContext(fakeCtx({ sessions: { get: () => ({ ...session }) }, fs: face }), 's2', { ...DEFAULT_CONFIG }, '继续')
    // A configured root override is a different directory.
    await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG, workspaceRoot: 'D:\\other' }, '继续')
    // Edited bounds change what the scan would read.
    await gatherContext(ctx, 's1', { ...DEFAULT_CONFIG, workspaceMaxFiles: 1 }, '继续')
    expect(calls.resolve).toBe(4)
  })
})

/**
 * The grounding layers must survive a host that is poorer than the interfaces
 * describe: the shape differences that only a real mount exposes (the lesson
 * behind the 0.2.3 render crash). Every one of them degrades to "no layer".
 */
describe('grounding against a poorer host than expected', () => {
  const fs = {
    resolve: async (path: string) => ({ targetKey: '', displayPath: path }),
    listDir: async () => [{ name: 'README.md', type: 'file', target: { targetKey: 'README.md', displayPath: 'README.md' } }],
    readText: async () => '# Proj',
  }

  it('skips the workspace layer when the fs service is missing methods', async () => {
    const partial = { resolve: async (path: string) => ({ targetKey: '', displayPath: path }) }
    const bundle = await gatherContext(fakeCtx({ fs: partial }), undefined, { ...DEFAULT_CONFIG }, '继续')
    expect(bundle).toEqual({ history: false, workspace: false, files: 0 })
  })

  it('ignores a session whose working directory is not a string', async () => {
    const bundle = await gatherContext(fakeCtx({ sessions: { get: () => ({ header: { cwd: 42 } }) }, fs }), 's1', { ...DEFAULT_CONFIG }, '继续')
    expect(bundle.workspace).toBe(false)
  })

  it('ignores a session whose deriveMessages is not callable', async () => {
    const session = { deriveMessages: 'not-a-function', header: { cwd: 'D:\\proj' } }
    const bundle = await gatherContext(fakeCtx({ sessions: { get: () => session }, fs }), 's1', { ...DEFAULT_CONFIG }, '继续')
    expect(bundle.history).toBe(false)
    expect(bundle.workspace).toBe(true)
  })

  it('skips both layers when the session is not an object', async () => {
    // No readable `header.cwd` (and no `deriveMessages`) means no root and no
    // history: both layers read as absent rather than throwing.
    const bundle = await gatherContext(fakeCtx({ sessions: { get: () => 'nope' }, fs }), 's1', { ...DEFAULT_CONFIG }, '继续')
    expect(bundle).toEqual({ history: false, workspace: false, files: 0 })
  })
})

/**
 * The wire report of the evidence layers (F5): attached when a layer applied,
 * absent — not falsy — when none did, so an ungrounded call keeps the exact
 * response shape older hosts produced.
 */
describe('runEnhance evidence report', () => {
  /** A one-chunk stream that yields readable text and a clean finish. */
  function textStream(): AsyncIterable<StreamChunk> {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '角色：工程师' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '角色：工程师' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    return (async function* (): AsyncGenerator<StreamChunk> {
      for (const chunk of chunks) yield chunk
    })()
  }

  const fs = {
    resolve: async (path: string) => ({ targetKey: '', displayPath: path }),
    listDir: async () => [{ name: 'README.md', type: 'file', target: { targetKey: 'README.md', displayPath: 'README.md' } }],
    readText: async () => '# Proj\nDSH prompt plugin',
  }

  beforeEach(() => {
    resetWorkspaceScanCache()
  })

  it('reports both layers and the file count on a grounded call', async () => {
    const session = {
      deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: '我们在做 DSH 插件' }] }],
      header: { cwd: 'D:\\proj' },
    }
    const ctx = fakeCtx({ llm: { stream: textStream }, sessions: { get: () => session }, fs })
    const result = await runEnhance(ctx, { ...DEFAULT_CONFIG }, {
      text: '帮我写个脚本',
      sessionRoute: { provider: 'p', model: 'm' },
      sessionId: 's1',
    })
    expect(result.evidence).toEqual({ history: true, workspace: true, files: 1 })
  })

  it('omits the report entirely when no layer applied', async () => {
    const ctx = fakeCtx({ llm: { stream: textStream } })
    const result = await runEnhance(ctx, { ...DEFAULT_CONFIG }, {
      text: '帮我写个脚本',
      sessionRoute: { provider: 'p', model: 'm' },
    })
    expect(result.evidence).toBeUndefined()
  })
})

describe('enhancement mode', () => {
  /** Stub LLM face that records every generate request it was handed. */
  function capturingLlm(text = '改写后的正文'): {
    llm: { stream: (options: Record<string, unknown>) => AsyncIterable<StreamChunk> }
    calls: Record<string, unknown>[]
  } {
    const calls: Record<string, unknown>[] = []
    const llm = {
      stream(options: Record<string, unknown>): AsyncIterable<StreamChunk> {
        calls.push(options)
        return (async function* (): AsyncGenerator<StreamChunk> {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }
    return { llm, calls }
  }

  const run = (ctx: Context, config: typeof DEFAULT_CONFIG, text = '帮我写个脚本') =>
    runEnhance(ctx as never, config, { text, sessionRoute: { provider: 'p', model: 'm' } })

  it('sends the byte-identical default prompt and no cap in standard mode', async () => {
    // 默认档是"什么都不做"：既不加词，也不设自己的上限。老用户升级后
    // 发出去的请求必须与升级前完全一致。
    const { llm, calls } = capturingLlm()
    await run(fakeCtx({ llm }), { ...DEFAULT_CONFIG })
    // 改写位声明默认开启，且只加在策略之前；策略本身逐字节不变。
    expect(calls[0]?.system).toBe(`${REWRITE_STANCE}\n\n${DEFAULT_SYSTEM_PROMPT}`)
    // 0 = 不设上限：enhancer 只在正数时才把 maxTokens 放进请求，所以这里
    // 该键根本不存在（不是传了 0）。
    expect(calls[0]?.maxTokens).toBeUndefined()
  })

  it('is byte-identical to the pre-stance request when the stance is off', async () => {
    const { llm, calls } = capturingLlm()
    await run(fakeCtx({ llm }), { ...DEFAULT_CONFIG, rewriterArmor: false })
    expect(calls[0]?.system).toBe(DEFAULT_SYSTEM_PROMPT)
  })

  it('appends the mode discipline and uses its own budget', async () => {
    const { llm, calls } = capturingLlm()
    await run(fakeCtx({ llm }), { ...DEFAULT_CONFIG, mode: 'spec' })
    expect(calls[0]?.system).toBe(`${REWRITE_STANCE}\n\n${DEFAULT_SYSTEM_PROMPT}${MODE_SPECS.spec.systemAddon}`)
    expect(calls[0]?.maxTokens).toBe(MODE_SPECS.spec.maxOutputTokens)

    const concise = capturingLlm()
    await run(fakeCtx({ llm: concise.llm }), { ...DEFAULT_CONFIG, mode: 'concise' })
    expect(concise.calls[0]?.system).toBe(`${REWRITE_STANCE}\n\n${DEFAULT_SYSTEM_PROMPT}${MODE_SPECS.concise.systemAddon}`)
    expect(concise.calls[0]?.maxTokens).toBe(2000)
  })

  it('lets an explicit token cap win over the mode budget', async () => {
    const { llm, calls } = capturingLlm()
    await run(fakeCtx({ llm }), { ...DEFAULT_CONFIG, mode: 'concise', maxOutputTokens: 4096 })
    expect(calls[0]?.maxTokens).toBe(4096)
  })

  it('lets a per-call mode override the configured one', async () => {
    // `/enhance --mode engineering …` 走的就是这条路径：单次请求换档，不动设置。
    const { llm, calls } = capturingLlm()
    await runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG }, {
      text: '帮我把这个需求写成施工单',
      sessionRoute: { provider: 'p', model: 'm' },
      mode: 'engineering',
    })
    expect(calls[0]?.system).toBe(`${REWRITE_STANCE}\n\n${DEFAULT_SYSTEM_PROMPT}${MODE_SPECS.engineering.systemAddon}`)
    expect(calls[0]?.maxTokens).toBe(MODE_SPECS.engineering.maxOutputTokens)
  })

  it('falls back to the configured mode when the per-call id is unknown', async () => {
    const { llm, calls } = capturingLlm()
    await runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG, mode: 'concise' }, {
      text: '帮我把这个需求写成施工单',
      sessionRoute: { provider: 'p', model: 'm' },
      mode: 'verbose',
    })
    expect(calls[0]?.system).toBe(`${REWRITE_STANCE}\n\n${DEFAULT_SYSTEM_PROMPT}${MODE_SPECS.concise.systemAddon}`)
    expect(calls[0]?.maxTokens).toBe(2000)
  })
})

describe('enhancement templates', () => {
  /** Stub LLM face that records every generate request it was handed. */
  function capturingLlm(text = '改写后的正文'): {
    llm: { stream: (options: Record<string, unknown>) => AsyncIterable<StreamChunk> }
    calls: Record<string, unknown>[]
  } {
    const calls: Record<string, unknown>[] = []
    const llm = {
      stream(options: Record<string, unknown>): AsyncIterable<StreamChunk> {
        calls.push(options)
        return (async function* (): AsyncGenerator<StreamChunk> {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }
    return { llm, calls }
  }

  it('appends the template discipline after the mode discipline', async () => {
    // 顺序是契约：模式先说"交付多大"，模板再说"交付成什么形状"。
    const { llm, calls } = capturingLlm()
    await runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG, mode: 'spec', template: 'api-doc' }, {
      text: '帮我写一下这个接口',
      sessionRoute: { provider: 'p', model: 'm' },
    })
    expect(calls[0]?.system).toBe(
      `${REWRITE_STANCE}\n\n${DEFAULT_SYSTEM_PROMPT}${MODE_SPECS.spec.systemAddon}${TEMPLATE_SPECS['api-doc'].systemAddon}`,
    )
  })

  it('sends the byte-identical default prompt when no template is selected', async () => {
    const { llm, calls } = capturingLlm()
    await runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG, rewriterArmor: false }, {
      text: '帮我写个脚本',
      sessionRoute: { provider: 'p', model: 'm' },
    })
    expect(calls[0]?.system).toBe(DEFAULT_SYSTEM_PROMPT)
  })

  it('lets a per-call template override the configured default', async () => {
    const { llm, calls } = capturingLlm()
    const result = await runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG, rewriterArmor: false, template: 'api-doc' }, {
      text: '帮我写个脚本',
      sessionRoute: { provider: 'p', model: 'm' },
      template: 'refactor',
    })
    expect(calls[0]?.system).toBe(`${DEFAULT_SYSTEM_PROMPT}${TEMPLATE_SPECS.refactor.systemAddon}`)
    expect(result.template).toBe('refactor')
  })

  it('reports the applied template only when one applied', async () => {
    const framed = capturingLlm()
    const withTemplate = await runEnhance(
      fakeCtx({ llm: framed.llm }),
      { ...DEFAULT_CONFIG, template: 'test-plan' },
      { text: '帮我写个脚本', sessionRoute: { provider: 'p', model: 'm' } },
    )
    expect(withTemplate.template).toBe('test-plan')

    const plain = capturingLlm()
    const without = await runEnhance(fakeCtx({ llm: plain.llm }), { ...DEFAULT_CONFIG }, {
      text: '帮我写个脚本',
      sessionRoute: { provider: 'p', model: 'm' },
    })
    // 默认路径不发模板字段：客户端拿它来标注历史条目，缺席即"没有模板"。
    expect(without).not.toHaveProperty('template')
  })
})

describe('slash-command drafts', () => {
  function capturingLlm(text = '改写后的正文'): {
    llm: { stream: (options: Record<string, unknown>) => AsyncIterable<StreamChunk> }
    calls: Record<string, unknown>[]
  } {
    const calls: Record<string, unknown>[] = []
    const llm = {
      stream(options: Record<string, unknown>): AsyncIterable<StreamChunk> {
        calls.push(options)
        return (async function* (): AsyncGenerator<StreamChunk> {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }
    return { llm, calls }
  }

  it('enhances only the prose and re-attaches the command verbatim', async () => {
    const { llm, calls } = capturingLlm()
    const result = await runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG }, {
      text: '/logs 200\n看看最近的日志，找出报错',
      sessionRoute: { provider: 'p', model: 'm' },
    })
    const sent = JSON.stringify(calls[0]?.messages)
    expect(sent).toContain('看看最近的日志，找出报错')
    expect(sent).not.toContain('/logs 200')
    expect(result.text).toBe('/logs 200\n改写后的正文')
  })

  it('sends a command-only draft nowhere and hands it back unchanged', async () => {
    // 没有正文就没有可改写的散文：不发模型调用，也不该把命令改坏。
    const { llm, calls } = capturingLlm()
    const result = await runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG }, {
      text: '/logs 200',
      sessionRoute: { provider: 'p', model: 'm' },
    })
    expect(calls).toHaveLength(0)
    expect(result.text).toBe('/logs 200')
    expect(result.elapsedMs).toBe(0)
    expect(result.provider).toBe('p')
    expect(result.model).toBe('m')
  })

  it('treats a slash path as prose, not as a command', async () => {
    const { llm, calls } = capturingLlm()
    await runEnhance(fakeCtx({ llm }), { ...DEFAULT_CONFIG }, {
      text: '/home/user/a.txt 帮我改一下',
      sessionRoute: { provider: 'p', model: 'm' },
    })
    expect(JSON.stringify(calls[0]?.messages)).toContain('/home/user/a.txt 帮我改一下')
  })
})
