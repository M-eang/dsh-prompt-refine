/**
 * 端到端：草稿里的 `@文件` / `/技能` 引用，在真实 HTTP 路由上被换成占位符、
 * 模型看不到真实路径、返回时逐字还原。
 *
 * 三个面都断言，缺一个就测不到真实行为：模型侧（收到的是占位符，系统提示带
 * 引用纪律）、响应侧（还原后的正文）、回执（`refs` 计数）。另外单独锁住
 * 「没有引用的草稿形状不变」—— 那条回归一旦破了，所有老宿主的响应都会变。
 * @module tests/refs-route
 */

import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply } from '../src/index'
import { DEFAULT_CONFIG } from '../src/config'

/** A passing config with the pairing invariants satisfied. */
const CONFIG = { ...DEFAULT_CONFIG }

/** Registered route captured from the stub webServer. */
interface CapturedRoute {
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>
}

/** Text stream helper: one text block, usage, terminal finish. */
function streamOf(parts: string[]): AsyncIterable<StreamChunk> {
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...parts.map((text): StreamChunk => ({ type: 'text-delta', index: 0, text })),
    { type: 'block-end', index: 0, block: { type: 'text', text: parts.join('') } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  return (async function* (): AsyncGenerator<StreamChunk> {
    for (const chunk of chunks) yield chunk
  })()
}

/**
 * Mount the route over real HTTP with a stub llm that always replies `reply`.
 * @param reply - the model's answer, in parts.
 * @param captured - receives every GenerateOptions the plugin sent.
 * @returns a listening server.
 */
function mount(reply: string[], captured: GenerateOptions[]): Server {
  const routes: CapturedRoute[] = []
  const ctx = {
    effect(fn: () => unknown): () => void {
      fn()
      return () => {}
    },
    get(key: string): unknown {
      if (key === 'webServer') {
        return { register(route: CapturedRoute): () => void { routes.push(route); return () => {} } }
      }
      if (key === 'llm') {
        return {
          stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
            captured.push(options)
            return streamOf(reply)
          },
        }
      }
      if (key === 'sessions') return { get: (): undefined => undefined }
      // The route resolves a provider/model pair through settings when the
      // plugin config leaves it empty; without this the call is `unconfigured`.
      if (key === 'settings') return { get: (): unknown => ({ provider: 'zhipu', model: 'glm-5.3' }) }
      return undefined
    },
    inject(): void {},
    emit(): void {},
    on(): () => void {
      return () => {}
    },
  }
  apply(ctx as never, CONFIG)
  const route = routes[0]
  if (route === undefined) throw new Error('route was not registered')
  return createServer((req, res) => {
    void route.handler(req, res)
  })
}

/**
 * Listen on an ephemeral loopback port.
 * @param server - the server to start.
 * @returns once it accepts connections.
 */
function listen(server: Server): Promise<void> {
  return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
}

/**
 * Close a server.
 * @param server - the server to stop.
 * @returns once it stopped.
 */
function close(server: Server): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()))
}

/** One enhance request. */
async function call(server: Server, text: string): Promise<{ status: number; json: { ok: boolean; value?: Record<string, unknown> } }> {
  const { port } = server.address() as AddressInfo
  const response = await fetch(`http://127.0.0.1:${port}/prompt-enhance/enhance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return { status: response.status, json: (await response.json()) as { ok: boolean; value?: Record<string, unknown> } }
}

/**
 * Run one draft through a fresh server and hand back what the model saw.
 * @param draft - the operator's draft.
 * @param reply - the model's answer.
 * @returns the response plus the GenerateOptions the plugin sent.
 */
async function roundTrip(draft: string, reply: string[]): Promise<{
  status: number
  value: Record<string, unknown> | undefined
  sent: GenerateOptions | undefined
}> {
  const captured: GenerateOptions[] = []
  const server = mount(reply, captured)
  await listen(server)
  try {
    const { status, json } = await call(server, draft)
    return { status, value: json.value, sent: captured[0] }
  } finally {
    await close(server)
  }
}

describe('references through the real route', () => {
  it('hides the reference from the model and restores it verbatim', async () => {
    const { status, value, sent } = await roundTrip(
      '看 @src/app.ts 有没有内存泄漏',
      ['⟦1⟧ 里那段循环有没有内存泄漏，给出修法。'],
    )
    expect(status).toBe(200)
    // 模型侧：只看到占位符，真实路径一个字都没出去。
    const wire = JSON.stringify(sent?.messages)
    expect(wire).toContain('⟦1⟧')
    expect(wire).not.toContain('@src/app.ts')
    // 系统提示确实带上了引用纪律（否则模型不知道占位符不能动）。
    expect(sent?.system).toContain('Reference tokens')
    // 响应侧：引用逐字回到原位。
    expect(value?.text).toBe('@src/app.ts 里那段循环有没有内存泄漏，给出修法。')
    expect(value?.refs).toEqual({ total: 1, restored: 1, missing: [] })
  })

  it('keeps the reference when the model drops the placeholder', async () => {
    const { value } = await roundTrip('看 @src/app.ts 有没有内存泄漏', ['这段循环有内存泄漏，改成惰性求值。'])
    // 丢掉的占位符不能让引用消失：原文追加在末尾，回执里点名。
    expect(String(value?.text).endsWith('\n\n@src/app.ts')).toBe(true)
    expect(value?.refs).toEqual({ total: 1, restored: 0, missing: ['@src/app.ts'] })
  })

  it('protects every reference kind in one draft', async () => {
    // 命令单独占一行：首行整行以 `/` 开头时它整行都是命令，正文在下一行。
    const { value, sent } = await roundTrip(
      '/code-review\n按 @docs/api.md 与 @"my plan.md" 重写',
      ['⟦1⟧ 的步骤：先照 ⟦2⟧ 核对，再按 ⟦3⟧ 排期。'],
    )
    const wire = JSON.stringify(sent?.messages)
    expect(wire).not.toContain('@docs/api.md')
    expect(wire).not.toContain('my plan.md')
    // 认不出的 ⟦3⟧ 被删掉，留下一个空格——比把占位符交给用户干净得多。
    expect(value?.text).toBe('/code-review\n@docs/api.md 的步骤：先照 @"my plan.md" 核对，再按  排期。')
    expect(value?.refs).toEqual({ total: 2, restored: 2, missing: [] })
  })

  it('keeps the leading slash command out of the model body', async () => {
    const { value, sent } = await roundTrip('/logs 200\n统计 @src/app.ts 的行数', ['⟦1⟧ 的行数统计一下'])
    // 命令不进正文、引用进占位符：两件事在同一次调用里各就各位。
    expect(JSON.stringify(sent?.messages)).not.toContain('/logs 200')
    expect(value?.text).toBe('/logs 200\n@src/app.ts 的行数统计一下')
  })

  it('leaves a draft with no references byte-identical in shape', async () => {
    // 没有引用就不许出现新字段、也不许多一段系统提示：老宿主的响应形状不变。
    const { value, sent } = await roundTrip('帮我把这段话改好', ['请把下面这段话改写得更清楚。'])
    expect(value?.refs).toBeUndefined()
    expect(sent?.system).not.toContain('Reference tokens')
    expect(value?.text).toBe('请把下面这段话改写得更清楚。')
  })
})
