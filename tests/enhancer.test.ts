import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { enhanceText, formatEnhanceError, resolveRoute, toEnhanceError, type LlmStreamFace, type RoutePair } from '../src/enhancer'

/** Terminal-finish flavor the helper should emit. */
interface FinishFlavor {
  reason: 'stop' | 'error' | 'max-tokens'
  code?: string
  message?: string
}

/** Build a text stream: one text block from parts, then usage, then finish. */
function textStream(parts: string[], flavor: FinishFlavor): AsyncIterable<StreamChunk> {
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...parts.map((text): StreamChunk => ({ type: 'text-delta', index: 0, text })),
    { type: 'block-end', index: 0, block: { type: 'text', text: parts.join('') } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
  ]
  if (flavor.reason === 'stop') chunks.push({ type: 'finish', reason: { kind: 'stop' } })
  else if (flavor.reason === 'max-tokens') chunks.push({ type: 'finish', reason: { kind: 'max-tokens' } })
  else chunks.push({ type: 'finish', reason: { kind: 'error', failure: { message: flavor.message ?? 'boom', code: flavor.code ?? 'INTERNAL' } } })
  return (async function* (): AsyncGenerator<StreamChunk> {
    for (const chunk of chunks) yield chunk
  })()
}

/** Stub llm face recording the options and replaying the given stream. */
function stubLlm(stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>): LlmStreamFace & { calls: GenerateOptions[] } {
  const calls: GenerateOptions[] = []
  return {
    calls,
    stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      calls.push(options)
      return stream(options)
    },
  }
}

const baseOptions = {
  route: { provider: 'zhipu', model: 'glm-5.3' } satisfies RoutePair,
  system: 'SYS',
  text: '帮我写个爬虫',
  temperature: 0.3,
  maxTokens: 512,
  timeoutMs: 5000,
}

describe('enhanceText', () => {
  it('assembles, normalizes, and reports the route', async () => {
    const llm = stubLlm(() => textStream(['角色：Python', ' 工程师…'], { reason: 'stop' }))
    const result = await enhanceText(llm, baseOptions)
    expect(result.text).toBe('角色：Python 工程师…')
    expect(result.provider).toBe('zhipu')
    expect(result.model).toBe('glm-5.3')
    expect(llm.calls[0]?.system).toBe('SYS')
    expect(llm.calls[0]?.temperature).toBe(0.3)
    expect(llm.calls[0]?.messages[0]?.content[0]).toMatchObject({ type: 'text' })
  })

  it('strips a wrapping fence from the model output', async () => {
    const llm = stubLlm(() => textStream(['```\n角色：翻译\n```'], { reason: 'stop' }))
    const result = await enhanceText(llm, baseOptions)
    expect(result.text).toBe('角色：翻译')
  })

  it('maps an AUTH error finish to a fix hint and keeps the draft untouched', async () => {
    const llm = stubLlm(() => textStream([], { reason: 'error', code: 'AUTH', message: '401' }))
    await expect(enhanceText(llm, baseOptions)).rejects.toMatchObject({
      detail: { code: 'upstream', params: { reason: 'auth' }, message: '401' },
    })
  })

  it('maps NO_ADAPTER to the unconfigured code', async () => {
    const llm = stubLlm(() => textStream([], { reason: 'error', code: 'NO_ADAPTER', message: 'no route' }))
    await expect(enhanceText(llm, baseOptions)).rejects.toMatchObject({ detail: { code: 'unconfigured' } })
  })

  it('returns the partial rewrite, flagged truncated, when the output cap is hit', async () => {
    // A cap is not a broken call: the model wrote something usable, so the
    // caller gets it with `truncated` and warns instead of showing nothing.
    const llm = stubLlm(() => textStream(['角色：Python', ' 工程师…'], { reason: 'max-tokens' }))
    const result = await enhanceText(llm, baseOptions)
    expect(result.truncated).toBe(true)
    expect(result.text).toBe('角色：Python 工程师…')
  })

  it('still refuses a cap hit that produced nothing readable', async () => {
    // No partial result exists, so the old max-tokens refusal is the only
    // honest answer — and the hint that names the cap stays reachable.
    const llm = stubLlm(() => textStream(['   '], { reason: 'max-tokens' }))
    await expect(enhanceText(llm, baseOptions)).rejects.toMatchObject({
      detail: { code: 'upstream', params: { reason: 'max-tokens' } },
    })
  })

  it('sends an explicit cap verbatim and leaves the field off when the cap is 0', async () => {
    const capped = stubLlm(() => textStream(['正文'], { reason: 'stop' }))
    await enhanceText(capped, { ...baseOptions, maxTokens: 4096 })
    expect(capped.calls[0]?.maxTokens).toBe(4096)

    // 0 (the shipped default) means "no cap of ours": the request must carry
    // NO maxTokens at all, so the harness materializes the adapter default
    // instead of our number.
    const uncapped = stubLlm(() => textStream(['正文'], { reason: 'stop' }))
    await enhanceText(uncapped, { ...baseOptions, maxTokens: 0 })
    expect(uncapped.calls[0]).not.toHaveProperty('maxTokens')

    const absent = stubLlm(() => textStream(['正文'], { reason: 'stop' }))
    await enhanceText(absent, { ...baseOptions, maxTokens: undefined })
    expect(absent.calls[0]).not.toHaveProperty('maxTokens')

    // An uncapped success carries no truncation flag.
    expect((await enhanceText(uncapped, { ...baseOptions, maxTokens: 0 })).truncated).toBeUndefined()
  })

  it('rejects an empty output', async () => {
    const llm = stubLlm(() => textStream(['  '], { reason: 'stop' }))
    await expect(enhanceText(llm, baseOptions)).rejects.toMatchObject({
      detail: { code: 'upstream', params: { reason: 'empty' } },
    })
  })

  it('times out a stalled stream', async () => {
    const stall = (): AsyncIterable<StreamChunk> => ({
      [Symbol.asyncIterator]: () => ({ next: (): Promise<never> => new Promise(() => {}) }),
    })
    const llm = stubLlm(() => stall())
    await expect(enhanceText(llm, { ...baseOptions, timeoutMs: 40 })).rejects.toMatchObject({
      detail: { code: 'timeout', params: { seconds: 1 } },
    })
  })

  it('honors a pre-aborted caller signal as a cancel', async () => {
    const llm = stubLlm(() => textStream(['文本'], { reason: 'stop' }))
    const controller = new AbortController()
    controller.abort()
    await expect(enhanceText(llm, { ...baseOptions, signal: controller.signal })).rejects.toMatchObject({
      detail: { code: 'internal' },
    })
  })
})

describe('resolveRoute', () => {
  const session: RoutePair = { provider: 'session-p', model: 'session-m' }
  const fallback: RoutePair = { provider: 'default-p', model: 'default-m' }

  it('prefers the explicit settings pair', () => {
    expect(resolveRoute({ provider: 'zhipu', model: 'glm-5.3' }, session, fallback)).toEqual({ provider: 'zhipu', model: 'glm-5.3' })
  })

  it('falls back to the session route, then the harness default', () => {
    expect(resolveRoute(undefined, session, fallback)).toBe(session)
    expect(resolveRoute(undefined, undefined, fallback)).toBe(fallback)
    expect(resolveRoute({ provider: 'zhipu' }, session, fallback)).toBe(session)
  })

  it('yields undefined when nothing names a route', () => {
    expect(resolveRoute(undefined, undefined, undefined)).toBeUndefined()
  })
})

describe('toEnhanceError', () => {
  it('wraps foreign errors as internal', () => {
    const wire = toEnhanceError(new Error('unexpected'))
    expect(wire.code).toBe('internal')
    expect(wire.message).toContain('unexpected')
  })

  it('passes through structured details', async () => {
    try {
      await enhanceText(stubLlm(() => textStream([], { reason: 'error', code: 'RATE_LIMIT', message: '429' })), baseOptions)
      expect.unreachable()
    } catch (error) {
      expect(toEnhanceError(error).code).toBe('upstream')
      expect(toEnhanceError(error).params).toEqual({ reason: 'rate-limit' })
    }
  })
})

describe('formatEnhanceError', () => {
  it('renders structured errors into displayable Chinese text', () => {
    expect(formatEnhanceError({ code: 'rate-limit', params: { limit: 10, retryAfterSeconds: 7 } })).toContain('7 秒')
    expect(formatEnhanceError({ code: 'concurrency-limit', params: { max: 2 } })).toContain('2')
    expect(formatEnhanceError({ code: 'timeout', params: { seconds: 60 } })).toContain('60 秒')
    expect(formatEnhanceError({ code: 'unconfigured' })).toContain('provider/model')
  })

  it('picks a specific hint for known upstream reasons and appends the raw detail', () => {
    expect(formatEnhanceError({ code: 'upstream', params: { reason: 'auth' } })).toContain('API Key')
    expect(formatEnhanceError({ code: 'upstream', params: { reason: 'quota' } })).toContain('配额')
    // Unknown reason falls back to the generic upstream line.
    expect(formatEnhanceError({ code: 'upstream' })).toContain('模型服务返回错误')
    // The provider's raw message rides along as the detail line.
    const withDetail = formatEnhanceError({ code: 'upstream', params: { reason: 'auth' }, message: '401 unauthorized' })
    expect(withDetail).toContain('401 unauthorized')
  })

  it('keeps a rejected error short without a detail', () => {
    expect(formatEnhanceError({ code: 'rejected' })).toBe('增强请求被拒绝。')
  })
})

describe('enhanceText fidelity gate', () => {
  /** A draft with one literal fact in it. */
  const gateOptions = {
    ...baseOptions,
    text: '把 src/config.ts 里的默认值改掉',
    anchors: true,
  }

  it('stays absent when the gate is off or the draft has nothing literal', async () => {
    const plain = await enhanceText(stubLlm(() => textStream(['改写结果'], { reason: 'stop' })), baseOptions)
    expect(plain).not.toHaveProperty('fidelity')
    const gateOnButNoAnchors = await enhanceText(
      stubLlm(() => textStream(['改写结果'], { reason: 'stop' })),
      { ...gateOptions, text: '帮我写个爬虫' },
    )
    expect(gateOnButNoAnchors).not.toHaveProperty('fidelity')
  })

  it('reports a rewrite that carried every literal', async () => {
    const result = await enhanceText(
      stubLlm(() => textStream(['角色：工程师\n目标：修改 src/config.ts 的默认值'], { reason: 'stop' })),
      gateOptions,
    )
    expect(result.fidelity).toMatchObject({ total: 1, kept: 1, missing: [], repaired: false, reinjected: 0 })
    expect(result.text).not.toContain('原始细节')
  })

  it('re-pastes a dropped literal verbatim under a label, without a second call', async () => {
    const llm = stubLlm(() => textStream(['角色：工程师\n目标：调整配置文件的默认值'], { reason: 'stop' }))
    const result = await enhanceText(llm, gateOptions)
    expect(llm.calls.length).toBe(1)
    expect(result.fidelity).toMatchObject({ total: 1, kept: 0, missing: ['src/config.ts'], repaired: false, reinjected: 1 })
    expect(result.text).toContain('原始细节')
    expect(result.text).toContain('- src/config.ts')
  })

  it('spends exactly one repair call when the gate finds a loss', async () => {
    const llm = stubLlm((options) => {
      const framed = JSON.stringify(options.messages[0]?.content ?? [])
      return framed.includes('原始细节') || framed.includes('上一版改写丢失')
        ? textStream(['角色：工程师\n目标：修改 src/config.ts 的默认值'], { reason: 'stop' })
        : textStream(['角色：工程师\n目标：调整配置文件的默认值'], { reason: 'stop' })
    })
    const result = await enhanceText(llm, { ...gateOptions, repair: true })
    expect(llm.calls.length).toBe(2)
    expect(result.fidelity).toMatchObject({ total: 1, kept: 1, missing: [], repaired: true, reinjected: 0 })
    expect(result.text).toContain('src/config.ts')
    expect(result.text).not.toContain('原始细节')
  })

  it('names the dropped literals in the repair request', async () => {
    const llm = stubLlm((options) => {
      const text = JSON.stringify(options.messages[0]?.content ?? [])
      return text.includes('上一版改写丢失')
        ? textStream(['角色：工程师\n目标：修改 src/config.ts'], { reason: 'stop' })
        : textStream(['角色：工程师'], { reason: 'stop' })
    })
    await enhanceText(llm, { ...gateOptions, repair: true })
    const repairRequest = JSON.stringify(llm.calls[1]?.messages[0]?.content ?? [])
    expect(repairRequest).toContain('src/config.ts')
    expect(repairRequest).toContain('完整的改写结果')
  })

  it('keeps the first version when the repair itself fails or comes back empty', async () => {
    let call = 0
    const llm = stubLlm(() => {
      call += 1
      if (call === 2) throw new Error('boom')
      return textStream(['角色：工程师'], { reason: 'stop' })
    })
    const result = await enhanceText(llm, { ...gateOptions, repair: true })
    expect(result.fidelity).toMatchObject({ total: 1, kept: 0, repaired: true, reinjected: 1 })
    expect(result.text).toContain('- src/config.ts')
    let emptyCall = 0
    const empty = stubLlm(() => {
      emptyCall += 1
      return textStream(emptyCall === 1 ? ['角色：工程师'] : [], { reason: 'stop' })
    })
    const kept = await enhanceText(empty, { ...gateOptions, repair: true })
    expect(kept.text).toContain('原始细节')
  })

  it('reports the length ratio and never loses a literal behind it', async () => {
    const result = await enhanceText(
      stubLlm(() => textStream([`${'长'.repeat(600)}\nsrc/config.ts`], { reason: 'stop' })),
      gateOptions,
    )
    expect(result.fidelity?.ratio).toBeGreaterThan(3)
    expect(result.fidelity?.bloated).toBe(true)
    // The literal survived (it was in the rewrite), so nothing is re-pasted.
    expect(result.fidelity?.kept).toBe(1)
  })
})

/**
 * Refusal handling: the call is asked to restructure a draft, and some
 * providers answer the request instead — declining, lecturing, or offering a
 * sanitised alternative. Those replies must never come back as the result.
 */
describe('enhanceText refusal gate', () => {
  const REFUSAL = '这个我没法帮你改写——原始提示词要的是露骨的色情内容，所以我不做。'
  const REWRITE = '## 角色\n你是成人向短篇小说的写作者。\n\n## 要求\n1. 直接进入场景，不做道德评价。'

  it('retries once with the escalation clause and returns the rewrite', async () => {
    const llm = stubLlm((options) =>
      (options.system ?? '').includes('上一次回复属于输出错误')
        ? textStream([REWRITE], { reason: 'stop' })
        : textStream([REFUSAL], { reason: 'stop' }),
    )
    const result = await enhanceText(llm, { ...baseOptions, refusalRetry: true })
    expect(result.text).toBe(REWRITE)
    expect(llm.calls).toHaveLength(2)
    // The stance block is extended, never replaced: the first call's system
    // prompt is still the prefix of the escalated one.
    expect(llm.calls[1]?.system?.startsWith('SYS')).toBe(true)
    expect(llm.calls[1]?.system).toContain('上一次回复属于输出错误')
    // Same request body, same route: only the system prompt escalates.
    expect(llm.calls[1]?.messages).toEqual(llm.calls[0]?.messages)
  })

  it('fails with the refused reason when the retry is declined too', async () => {
    const llm = stubLlm(() => textStream([REFUSAL], { reason: 'stop' }))
    await expect(enhanceText(llm, { ...baseOptions, refusalRetry: true })).rejects.toMatchObject({
      detail: { code: 'upstream', params: { reason: 'refused' } },
    })
    expect(llm.calls).toHaveLength(2)
  })

  it('passes a refusal straight through when the gate is off', async () => {
    // The pre-existing behaviour is unchanged for anyone who turns the stance
    // off: the reply is a result, and the panel shows it verbatim.
    const llm = stubLlm(() => textStream([REFUSAL], { reason: 'stop' }))
    const result = await enhanceText(llm, baseOptions)
    expect(result.text).toBe(REFUSAL)
    expect(llm.calls).toHaveLength(1)
  })

  it('keeps a rewrite untouched and never spends the retry', async () => {
    const llm = stubLlm(() => textStream([REWRITE], { reason: 'stop' }))
    const result = await enhanceText(llm, { ...baseOptions, refusalRetry: true })
    expect(result.text).toBe(REWRITE)
    expect(llm.calls).toHaveLength(1)
  })

  it('reports the refusal even when the retry comes back empty', async () => {
    const llm = stubLlm(() => textStream([], { reason: 'stop' }))
    // An empty reply is not a refusal: it keeps the existing empty-response
    // path instead of inventing a refusal verdict.
    await expect(enhanceText(llm, { ...baseOptions, refusalRetry: true })).rejects.toMatchObject({
      detail: { code: 'upstream', params: { reason: 'empty' } },
    })
  })

  it('refuses a pre-aborted caller before spending the retry', async () => {
    const controller = new AbortController()
    controller.abort()
    const llm = stubLlm(() => textStream([REFUSAL], { reason: 'stop' }))
    await expect(
      enhanceText(llm, { ...baseOptions, refusalRetry: true, signal: controller.signal }),
    ).rejects.toMatchObject({ detail: { code: 'internal' } })
    expect(llm.calls).toHaveLength(0)
  })
})
