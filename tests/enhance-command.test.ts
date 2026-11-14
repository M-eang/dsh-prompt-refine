/**
 * Tests of the /enhance slash command: the guard chain (empty / disabled /
 * over-length), the success path, and the failure mapping. The LLM round-trip
 * is stubbed at the orchestrate boundary so this file stays focused on the
 * command's own logic — previously the only user-facing surface with zero
 * coverage.
 * @module tests/enhance-command
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import { DEFAULT_CONFIG, type Config } from '../src/config'
import { registerEnhanceCommand } from '../src/enhance-command'
import { runEnhance, sessionRouteOf } from '../src/orchestrate'
import { ENHANCE_TEMPLATES } from '../src/shared/templates'
import { ENHANCE_MODES } from '../src/shared/modes'

vi.mock('../src/orchestrate', () => ({
  runEnhance: vi.fn(),
  sessionRouteOf: vi.fn(() => undefined),
}))

/** One command registration captured from the stub commands service. */
function captureDefinition(readConfig: () => Config = () => ({ ...DEFAULT_CONFIG })): CommandDefinition {
  let captured: CommandDefinition | undefined
  const commands = {
    register: (definition: CommandDefinition): (() => void) => {
      captured = definition
      return () => {}
    },
  }
  const ctx = {
    get: (key: string) => (key === 'commands' ? commands : undefined),
    effect: (fn: () => unknown) => fn(),
  } as unknown as Context
  registerEnhanceCommand(ctx, readConfig)
  if (captured === undefined) throw new Error('registerEnhanceCommand did not register')
  return captured
}

/** Minimal invocation shape; brand types are irrelevant to the command logic. */
function invocation(rawInput: string): CommandInvocation {
  return {
    commandId: 'cmd-1',
    agent: { session: { id: 's1' } },
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  } as unknown as CommandInvocation
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sessionRouteOf).mockReturnValue(undefined)
})

describe('/enhance slash command', () => {
  it('silently skips when the commands service is absent', () => {
    const effect = vi.fn()
    const ctx = { get: () => undefined, effect } as unknown as Context
    expect(() => registerEnhanceCommand(ctx, () => ({ ...DEFAULT_CONFIG }))).not.toThrow()
    expect(effect).not.toHaveBeenCalled()
  })

  it('registers a command named "enhance" with recordInput disabled', () => {
    const definition = captureDefinition()
    expect(definition.name).toBe('enhance')
    expect(definition.recordInput).toBe(false)
  })

  it('rejects an empty argument with a usage hint', async () => {
    const definition = captureDefinition()
    const result = await definition.handler(invocation('   '))
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('/enhance')
    expect(runEnhance).not.toHaveBeenCalled()
  })

  it('rejects when the plugin is disabled', async () => {
    const definition = captureDefinition(() => ({ ...DEFAULT_CONFIG, enabled: false }))
    const result = await definition.handler(invocation('hello'))
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('关闭')
    expect(runEnhance).not.toHaveBeenCalled()
  })

  it('rejects over-length input without calling the LLM', async () => {
    const definition = captureDefinition(() => ({ ...DEFAULT_CONFIG, maxInputChars: 10 }))
    const result = await definition.handler(invocation('x'.repeat(20)))
    expect(result.kind).toBe('error')
    expect(runEnhance).not.toHaveBeenCalled()
  })

  it('returns the enhanced text and passes the session route through', async () => {
    const sessionRoute = { provider: 'p', model: 'm' }
    vi.mocked(sessionRouteOf).mockReturnValue(sessionRoute)
    vi.mocked(runEnhance).mockResolvedValue({ text: 'enhanced', provider: 'p', model: 'm', elapsedMs: 5 })
    const definition = captureDefinition()
    const result = await definition.handler(invocation('hello'))
    expect(result).toEqual({ kind: 'success', text: 'enhanced' })
    // The session route must be read from the invocation's session id and
    // handed to runEnhance unchanged — dropping either line regresses this.
    expect(sessionRouteOf).toHaveBeenCalledTimes(1)
    expect(sessionRouteOf).toHaveBeenCalledWith(expect.anything(), 's1')
    expect(runEnhance).toHaveBeenCalledTimes(1)
    const call = vi.mocked(runEnhance).mock.calls[0]!
    expect(call[2]).toEqual(expect.objectContaining({ text: 'hello', sessionId: 's1', sessionRoute }))
    expect(call[2].signal).toBeInstanceOf(AbortSignal)
  })

  it('appends a cap note when the rewrite came back truncated', async () => {
    // The command plane has no warning affordance of its own, so a capped
    // rewrite must say so in the text it returns — otherwise the partial body
    // reads as a finished rewrite.
    vi.mocked(runEnhance).mockResolvedValue({ text: '半截正文', provider: 'p', model: 'm', elapsedMs: 5, truncated: true })
    const definition = captureDefinition()
    const result = await definition.handler(invocation('hello'))
    expect(result.kind).toBe('success')
    const text = (result as { text: string }).text
    expect(text).toContain('半截正文')
    expect(text).toContain('已达输出上限')
  })

  it('maps a thrown failure through the error formatter', async () => {
    vi.mocked(runEnhance).mockRejectedValue(new Error('boom'))
    const definition = captureDefinition()
    const result = await definition.handler(invocation('hello'))
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('增强失败')
  })

  it('lists the built-in templates without calling the model', async () => {
    const definition = captureDefinition()
    const result = await definition.handler(invocation('templates'))
    expect(result.kind).toBe('success')
    const text = (result as { text: string }).text
    for (const id of ENHANCE_TEMPLATES) expect(text).toContain(id)
    expect(runEnhance).not.toHaveBeenCalled()
  })

  it('takes a leading template id and passes only the prose on', async () => {
    vi.mocked(runEnhance).mockResolvedValue({ text: 'enhanced', provider: 'p', model: 'm', elapsedMs: 5 })
    const definition = captureDefinition()
    const result = await definition.handler(invocation('code-review 帮我看下这段改动'))
    expect(result).toEqual({ kind: 'success', text: 'enhanced' })
    const call = vi.mocked(runEnhance).mock.calls[0]!
    expect(call[2]).toEqual(expect.objectContaining({ text: '帮我看下这段改动', template: 'code-review' }))
  })

  it('treats an unknown first word as prose, never as a template', async () => {
    // 命令的第一个词经常就是正文的一部分：猜错吃掉它比不识别模板更糟。
    vi.mocked(runEnhance).mockResolvedValue({ text: 'enhanced', provider: 'p', model: 'm', elapsedMs: 5 })
    const definition = captureDefinition()
    await definition.handler(invocation('/logs 200 看看报错'))
    const call = vi.mocked(runEnhance).mock.calls[0]!
    const handed = call[2] as { text: string; template?: string }
    expect(handed.text).toBe('/logs 200 看看报错')
    expect(handed.template).toBeUndefined()
  })

  it('lists the enhancement modes without calling the model', async () => {
    const definition = captureDefinition()
    const result = await definition.handler(invocation('modes'))
    expect(result.kind).toBe('success')
    const text = (result as { text: string }).text
    for (const mode of ENHANCE_MODES) expect(text).toContain(mode)
    expect(runEnhance).not.toHaveBeenCalled()
  })

  it('takes --mode and passes only the prose on', async () => {
    vi.mocked(runEnhance).mockResolvedValue({ text: 'enhanced', provider: 'p', model: 'm', elapsedMs: 5 })
    const definition = captureDefinition()
    const result = await definition.handler(invocation('--mode engineering 帮我把这个需求写成施工单'))
    expect(result).toEqual({ kind: 'success', text: 'enhanced' })
    const call = vi.mocked(runEnhance).mock.calls[0]!
    expect(call[2]).toEqual(expect.objectContaining({ text: '帮我把这个需求写成施工单', mode: 'engineering' }))
  })

  it('accepts the -m alias together with a template', async () => {
    vi.mocked(runEnhance).mockResolvedValue({ text: 'enhanced', provider: 'p', model: 'm', elapsedMs: 5 })
    const definition = captureDefinition()
    await definition.handler(invocation('-m colloquial code-review 帮我看下这段改动'))
    const call = vi.mocked(runEnhance).mock.calls[0]!
    expect(call[2]).toEqual(expect.objectContaining({ text: '帮我看下这段改动', mode: 'colloquial', template: 'code-review' }))
  })

  it('rejects an unknown --mode id instead of silently keeping the configured one', async () => {
    const definition = captureDefinition()
    const result = await definition.handler(invocation('--mode verbose 写点东西'))
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('未知档位')
    expect(runEnhance).not.toHaveBeenCalled()
  })

  it('refuses a template with no body instead of sending an empty draft', async () => {
    const definition = captureDefinition()
    const result = await definition.handler(invocation('api-doc'))
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('api-doc')
    expect(runEnhance).not.toHaveBeenCalled()
  })
})
