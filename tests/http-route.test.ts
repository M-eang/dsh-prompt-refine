/**
 * End-to-end tests of the POST /prompt-enhance/enhance route over a real
 * node:http server: loopback fence, method guard, body validation, the
 * structured error envelope, and the full happy path through a stubbed
 * ctx.llm (real BlockAssembler/createUserMessage).
 * @module tests/http-route
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply } from '../src/index'
import { DEFAULT_CONFIG } from '../src/config'
import { ENHANCE_PREFIX } from '../src/shared/protocol'

/** A passing config with the pairing invariants satisfied. */
const CONFIG = { ...DEFAULT_CONFIG }

/** Registered route captured from the stub webServer. */
interface CapturedRoute {
  kind: string
  path: string
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>
}

/** Build a stub llm whose stream is replaced per test. */
function makeLlm(stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>): { stream(options: GenerateOptions): AsyncIterable<StreamChunk> } {
  return { stream }
}

/** Text stream helper: one text block, usage, terminal finish. */
function streamOf(parts: string[], finish: StreamChunk[]): AsyncIterable<StreamChunk> {
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...parts.map((text): StreamChunk => ({ type: 'text-delta', index: 0, text })),
    { type: 'block-end', index: 0, block: { type: 'text', text: parts.join('') } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
    ...finish,
  ]
  return (async function* (): AsyncGenerator<StreamChunk> {
    for (const chunk of chunks) yield chunk
  })()
}

/** A stub context plus the routes captured from its stub webServer. */
interface StubContext {
  ctx: unknown
  captured: CapturedRoute[]
}

/** Build a stub context exposing the services the plugin half reads. */
function stubContext(llm: ReturnType<typeof makeLlm>, services: Record<string, unknown> = {}): StubContext {
  const captured: CapturedRoute[] = []
  const ctx = {
    effect(fn: () => unknown): () => void {
      fn()
      return () => {}
    },
    get(key: string): unknown {
      // Explicit service overrides win, so a test can supply a real sessions
      // store or an `fs` face without re-declaring the whole composition.
      if (key in services) return services[key]
      if (key === 'webServer') {
        return { register(route: CapturedRoute): () => void { captured.push(route); return () => {} } }
      }
      if (key === 'llm') return llm
      if (key === 'sessions') return { get: (): undefined => undefined }
      if (key === 'settings') return { get: (): unknown => ({ provider: 'zhipu', model: 'glm-5.3' }) }
      return undefined
    },
    inject(): void {},
    emit(): void {},
    on(): () => void {
      return () => {}
    },
  }
  return { ctx, captured }
}

/** Mount apply() against a stub context and expose the route over real HTTP. */
function mount(
  llm: ReturnType<typeof makeLlm>,
  config = CONFIG,
  services: Record<string, unknown> = {},
): Server {
  const { ctx, captured } = stubContext(llm, services)
  apply(ctx as never, config)
  const route = captured[0]
  if (route === undefined) throw new Error('route was not registered')
  const server = createServer((req, res) => {
    void route.handler(req, res)
  })
  return server
}

/** One request against the test server. */
async function call(server: Server, method: string, body?: string, path = '/prompt-enhance/enhance', extraHeaders: Record<string, string> = {}): Promise<{ status: number; json: unknown; headers: Headers }> {
  const { port } = server.address() as AddressInfo
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json', ...extraHeaders }, body } : { headers: { ...extraHeaders } }),
  })
  return { status: response.status, json: (await response.json()) as unknown, headers: response.headers }
}

describe('POST /prompt-enhance/enhance (real http)', () => {
  let server: Server
  beforeAll(() => {
    server = mount(makeLlm(() => streamOf(['角色：Python 工程师。\n目标：写一个爬虫。'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('returns the enhanced text with the resolved route', async () => {
    const { status, json, headers } = await call(server, 'POST', JSON.stringify({ text: '帮我写个爬虫' }))
    expect(status).toBe(200)
    expect(headers.get('cache-control')).toBe('no-store')
    expect(json).toMatchObject({
      ok: true,
      value: { text: '角色：Python 工程师。\n目标：写一个爬虫。', provider: 'zhipu', model: 'glm-5.3' },
    })
  })

  it('trims spaced provider/model from settings before the adapter call', async () => {
    const captured: GenerateOptions[] = []
    const capturingLlm = {
      stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        captured.push(options)
        return streamOf(['结果'], [{ type: 'finish', reason: { kind: 'stop' } }])
      },
    } as never
    const server = mount(capturingLlm, { ...CONFIG, provider: ' zhipu ', model: ' glm ' })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status } = await call(server, 'POST', JSON.stringify({ text: '写' }))
      expect(status).toBe(200)
      expect(captured[0]?.provider).toBe('zhipu')
      expect(captured[0]?.model).toBe('glm')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('applies a per-call mode from the request body', async () => {
    const captured: GenerateOptions[] = []
    const capturingLlm = {
      stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        captured.push(options)
        return streamOf(['施工单'], [{ type: 'finish', reason: { kind: 'stop' } }])
      },
    }
    const server = mount(capturingLlm)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status } = await call(server, 'POST', JSON.stringify({ text: '写', mode: 'engineering' }))
      expect(status).toBe(200)
      expect(captured[0]?.system).toContain('Mode: engineering.')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('answers 415 for a non-JSON content type', async () => {
    const { port } = server.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${port}/prompt-enhance/enhance`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ text: '写' }),
    })
    expect(response.status).toBe(415)
  })

  it('serves a local caller that sends no Origin header', async () => {
    // Deliberate, not a gap: a local process sending no Origin IS served. The
    // loopback socket plus the Host allowlist are the trust boundary; Origin
    // only defeats cross-site browser POSTs, which always carry one. Any local
    // process is inside this route's trust model by design.
    const server = mount(makeLlm(() => streamOf(['结果'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}/prompt-enhance/enhance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '写' }),
      })
      expect(response.status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('fast-rejects an oversized Content-Length with 413 before reading', async () => {
    const http = await import('node:http')
    const { port } = server.address() as AddressInfo
    const status = await new Promise<number>((resolve) => {
      const request = http.request(
        { host: '127.0.0.1', port, method: 'POST', path: '/prompt-enhance/enhance', headers: { 'content-type': 'application/json', 'content-length': '99999999' } },
        (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        },
      )
      request.on('error', () => resolve(0))
      request.end('x')
    })
    expect(status).toBe(413)
  })

  it('answers 404 for unknown subpaths under the prefix', async () => {
    const { status } = await call(server, 'POST', JSON.stringify({ text: '写个脚本' }), '/prompt-enhance/anything')
    expect(status).toBe(404)
  })

  it('rejects an empty draft with 422', async () => {
    const { status, json } = await call(server, 'POST', JSON.stringify({ text: '   ' }))
    expect(status).toBe(422)
    expect(json).toMatchObject({ ok: false, error: { code: 'rejected' } })
  })

  it('rejects malformed JSON with 422', async () => {
    const { status, json } = await call(server, 'POST', '{nope')
    expect(status).toBe(422)
    expect(json).toMatchObject({ ok: false, error: { code: 'rejected' } })
  })

  it('rejects a GET with 405', async () => {
    const { status, json } = await call(server, 'GET')
    expect(status).toBe(405)
    expect(json).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('fences non-loopback peers at the socket-address level', async () => {
    const { isLoopbackRequest } = await import('../src/loopback')
    expect(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } } as never)).toBe(true)
    expect(isLoopbackRequest({ socket: { remoteAddress: '::1' } } as never)).toBe(true)
    expect(isLoopbackRequest({ socket: { remoteAddress: '192.168.1.7' } } as never)).toBe(false)
    expect(isLoopbackRequest({ socket: { remoteAddress: '' } } as never)).toBe(false)
  })
})

describe('POST /prompt-enhance/enhance failure mapping (real http)', () => {
  it('maps an AUTH error finish to 502 with a fix hint', async () => {
    const server = mount(makeLlm(() => streamOf([], [{ type: 'finish', reason: { kind: 'error', failure: { message: '401 unauthorized', code: 'AUTH' } } }])))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status, json } = await call(server, 'POST', JSON.stringify({ text: '写个脚本' }))
      expect(status).toBe(502)
      expect(json).toMatchObject({
        ok: false,
        error: { code: 'upstream', params: { reason: 'auth' }, message: '401 unauthorized' },
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('maps a timeout to 504', { timeout: 12000 }, async () => {
    const stall = (): AsyncIterable<StreamChunk> => ({
      [Symbol.asyncIterator]: () => ({ next: (): Promise<never> => new Promise(() => {}) }),
    })
    const server = mount(makeLlm(stall), { ...CONFIG, timeoutMs: 5000 })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status, json } = await call(server, 'POST', JSON.stringify({ text: '写个脚本' }))
      expect(status).toBe(504)
      expect(json).toMatchObject({ ok: false, error: { code: 'timeout' } })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('returns a capped rewrite as a success flagged truncated, not as an error', async () => {
    const server = mount(makeLlm(() => streamOf(['角色：Python 工程师。\n目标：写一个'], [{ type: 'finish', reason: { kind: 'max-tokens' } }])))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status, json } = await call(server, 'POST', JSON.stringify({ text: '帮我写个爬虫' }))
      expect(status).toBe(200)
      expect(json).toMatchObject({ ok: true, value: { truncated: true } })
      // The partial body is handed back verbatim (normalized), so the panel has
      // something to apply while it warns.
      expect((json as { value: { text: string } }).value.text).toBe('角色：Python 工程师。\n目标：写一个')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('keeps refusing a cap hit that produced no readable text', async () => {
    const server = mount(makeLlm(() => streamOf(['   '], [{ type: 'finish', reason: { kind: 'max-tokens' } }])))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status, json } = await call(server, 'POST', JSON.stringify({ text: '帮我写个爬虫' }))
      expect(status).toBe(502)
      expect(json).toMatchObject({ ok: false, error: { code: 'upstream', params: { reason: 'max-tokens' } } })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('refuses calls while disabled with 403', async () => {
    const server = mount(makeLlm(() => streamOf([], [{ type: 'finish', reason: { kind: 'stop' } }])), { ...CONFIG, enabled: false })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status } = await call(server, 'POST', JSON.stringify({ text: '写个脚本' }))
      expect(status).toBe(403)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('POST /prompt-enhance/enhance disconnect handling (real sockets)', () => {
  it('aborts the model call when the client disconnects mid-flight', async () => {
    const seen: boolean[] = []
    let capturedSignal: AbortSignal | undefined
    const server = mount({
      stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        capturedSignal = options.signal
        return {
          [Symbol.asyncIterator]: () => ({
            async next(): Promise<IteratorResult<StreamChunk>> {
              await new Promise((resolve) => setTimeout(resolve, 120))
              seen.push(capturedSignal?.aborted ?? false)
              if (capturedSignal?.aborted) {
                const error = new Error('aborted')
                error.name = 'AbortError'
                throw error
              }
              return { done: false, value: { type: 'text-delta', index: 0, text: 'x' } }
            },
          }),
        }
      },
    } as never, { ...CONFIG })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const net = await import('node:net')
    const socket = net.connect({ port, host: '127.0.0.1' }, () => {
      const body = JSON.stringify({ text: '写个脚本' })
      socket.write(`POST /prompt-enhance/enhance HTTP/1.1\r\nHost: 127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
      setTimeout(() => socket.destroy(), 80)
    })
    socket.on('error', () => {})
    try {
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(seen.length).toBeGreaterThan(0)
      expect(seen[seen.length - 1]).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('gives the concurrency slot back after a mid-flight disconnect', async () => {
    // The first call stalls forever; the second answers immediately. If the
    // disconnect failed to release the slot, the second call would 429 and
    // every later enhancement would be locked out for the process lifetime.
    const stall = (): AsyncIterable<StreamChunk> => ({
      [Symbol.asyncIterator]: () => ({ next: (): Promise<never> => new Promise(() => {}) }),
    })
    let calls = 0
    const server = mount({
      stream: (): AsyncIterable<StreamChunk> => {
        calls += 1
        return calls === 1 ? stall() : streamOf(['结果'], [{ type: 'finish', reason: { kind: 'stop' } }])
      },
    } as never, { ...CONFIG, maxConcurrent: 1 })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const net = await import('node:net')
    const body = JSON.stringify({ text: '占用者' })
    await new Promise<void>((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' }, () => {
        socket.write(`POST /prompt-enhance/enhance HTTP/1.1\r\nHost: 127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
        setTimeout(() => {
          socket.destroy()
          resolve()
        }, 120)
      })
      socket.on('error', () => {})
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    try {
      const later = await call(server, 'POST', JSON.stringify({ text: '后来者' }))
      expect(later.status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('admission gate: Origin / rate / concurrency', () => {
  it('refuses cross-site Origins with 403', async () => {
    const server = mount(makeLlm(() => streamOf(['x'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}/prompt-enhance/enhance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.com' },
        body: JSON.stringify({ text: '写个脚本' }),
      })
      expect(response.status).toBe(403)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('accepts same-app local Origins', async () => {
    const server = mount(makeLlm(() => streamOf(['x'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}/prompt-enhance/enhance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:' + port },
        body: JSON.stringify({ text: '写个脚本' }),
      })
      expect(response.status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('answers 429 when the per-minute rate cap is hit', async () => {
    const server = mount(makeLlm(() => streamOf(['x'], [{ type: 'finish', reason: { kind: 'stop' } }])), { ...CONFIG, rateLimitPerMinute: 1 })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const first = await call(server, 'POST', JSON.stringify({ text: '第一个' }))
      expect(first.status).toBe(200)
      const second = await call(server, 'POST', JSON.stringify({ text: '第二个' }))
      expect(second.status).toBe(429)
      expect(second.json).toMatchObject({ ok: false, error: { code: 'rate-limit', params: { limit: 1, retryAfterSeconds: expect.any(Number) } } })
      // The window is bounded, so the route can name the wait exactly.
      const retryAfter = Number(second.headers.get('retry-after'))
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(60)
      expect((second.json as { error: { params: { retryAfterSeconds: number } } }).error.params.retryAfterSeconds).toBe(retryAfter)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('does not burn the rate window on failed calls', async () => {
    // The window counts successes only: a failed call must not consume the
    // only slot, or a run of upstream errors would rate-limit the user right
    // when the model recovers.
    let calls = 0
    const server = mount({
      stream: (): AsyncIterable<StreamChunk> => {
        calls += 1
        return calls === 1
          ? streamOf([], [{ type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'INTERNAL' } } }])
          : streamOf(['结果'], [{ type: 'finish', reason: { kind: 'stop' } }])
      },
    } as never, { ...CONFIG, rateLimitPerMinute: 1 })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const first = await call(server, 'POST', JSON.stringify({ text: '失败' }))
      expect(first.status).toBe(502)
      const second = await call(server, 'POST', JSON.stringify({ text: '成功' }))
      expect(second.status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('answers 429 when the concurrency cap is full', async () => {
    let release!: () => void
    const gated = new Promise<void>((resolve) => { release = resolve })
    const gatedStream = (): AsyncIterable<StreamChunk> => (
      (async function* (): AsyncGenerator<StreamChunk> {
        await gated
        yield { type: 'text-delta', index: 0, text: 'x' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    )
    const server = mount({ stream: () => gatedStream() } as never, { ...CONFIG, maxConcurrent: 1 })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const first = call(server, 'POST', JSON.stringify({ text: '占用者' }))
      await new Promise((resolve) => setTimeout(resolve, 120))
      const second = await call(server, 'POST', JSON.stringify({ text: '后来者' }))
      expect(second.status).toBe(429)
      expect(second.json).toMatchObject({ ok: false, error: { code: 'concurrency-limit' } })
      // A busy slot frees unpredictably, so no Retry-After is advertised.
      expect(second.headers.get('retry-after')).toBeNull()
      release()
      const firstResult = await first
      expect(firstResult.status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('POST /prompt-enhance/enhance-stream (real http, SSE)', () => {
  /**
   * POST one draft and read the SSE body INCREMENTALLY.
   *
   * Incremental reading is mandatory, not stylistic: the route applies real
   * socket backpressure, so a server frame that fills the buffer parks until
   * the reader drains it. `response.text()` would therefore wait for a body the
   * server is waiting for the reader to consume — the hang this helper exists
   * to avoid. A real browser client streams the same way.
   *
   * This helper is also the regression lock for response termination: it only
   * resolves once the stream ENDS. The route must call `res.end()` after the
   * done frame — without it the chunked body lacks its `0\r\n\r\n` terminator
   * and the read never completes (the browser client hides that by returning on
   * the done frame and cancelling its reader), so these tests time out.
   */
  async function callStream(server: Server, text: string, extraHeaders: Record<string, string> = {}): Promise<{ status: number; contentType: string; body: string }> {
    const { port } = server.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${port}/prompt-enhance/enhance-stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...extraHeaders },
      body: JSON.stringify({ text }),
      // Fail fast instead of eating vitest's whole 5 s budget if the stream
      // ever stops progressing: a hang here is a route bug, not a slow test.
      signal: AbortSignal.timeout(2000),
    })
    const reader = response.body?.getReader()
    if (reader === undefined) return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: '' }
    const decoder = new TextDecoder()
    let body = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        body += decoder.decode(value, { stream: true })
      }
    } finally {
      void Promise.resolve().then(() => reader.cancel()).catch(() => {})
    }
    return { status: response.status, contentType: response.headers.get('content-type') ?? '', body }
  }

  /** The `data:` payloads of every SSE frame, in arrival order. */
  function framesOf(body: string): { event: string; data: unknown }[] {
    return body
      .split('\n\n')
      .map((raw) => raw.trim())
      .filter((raw) => raw !== '' && !raw.startsWith(':'))
      .map((raw) => {
        let event = 'message'
        const data: string[] = []
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).trim())
        }
        return { event, data: JSON.parse(data.join('\n')) as unknown }
      })
  }

  it('answers with SSE frames whose done body equals the one-shot result', async () => {
    const server = mount(makeLlm(() => streamOf(['角色：', 'Python 工程师。'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status, contentType, body } = await callStream(server, '写个爬虫')
      expect(status).toBe(200)
      expect(contentType).toContain('text/event-stream')
      // The header-flushing comment frame is mandatory: without it the client's
      // reader would not resume until the first model token arrived.
      expect(body.startsWith(': open\n\n')).toBe(true)

      const frames = framesOf(body)
      const done = frames.filter((frame) => frame.event === 'done')
      expect(done).toHaveLength(1)
      expect(done[0]!.data).toMatchObject({
        type: 'done',
        value: { text: '角色：Python 工程师。', provider: 'zhipu', model: 'glm-5.3' },
      })
      // Deltas are display-only; the authoritative body rides the done frame.
      expect(frames.some((frame) => frame.event === 'delta')).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('never shows a fence the normalized body will not have', async () => {
    // The model wraps its answer in a code fence. The displayed deltas must not
    // flash that fence, and the done body must carry the unwrapped text — the
    // streaming path is display-only and cannot change what the user applies.
    const server = mount(makeLlm(() => streamOf(['```\n角色：翻译。\n```'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status, body } = await callStream(server, '帮我翻译')
      expect(status).toBe(200)
      const done = framesOf(body).find((frame) => frame.event === 'done')
      expect(done?.data).toMatchObject({ value: { text: '角色：翻译。' } })
      expect(body).not.toContain('```')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('runs the same loopback fence as the one-shot route', async () => {
    const server = mount(makeLlm(() => streamOf(['x'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}/prompt-enhance/enhance-stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', forwarded: 'for=1.2.3.4' },
        body: JSON.stringify({ text: '写' }),
      })
      expect(response.status).toBe(403)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('route registration', () => {
  it('registers one route — and one admission gate — per context', () => {
    // A second apply on the same context must not stack a second gate: two
    // gates would silently double the effective rate and concurrency limits.
    const { ctx, captured } = stubContext(makeLlm(() => streamOf(['x'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    apply(ctx as never, CONFIG)
    apply(ctx as never, CONFIG)
    expect(captured).toHaveLength(1)
  })

  it('registers a fresh route for a different context', () => {
    const first = stubContext(makeLlm(() => streamOf(['x'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    const second = stubContext(makeLlm(() => streamOf(['x'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    apply(first.ctx as never, CONFIG)
    apply(second.ctx as never, CONFIG)
    expect(first.captured).toHaveLength(1)
    expect(second.captured).toHaveLength(1)
  })
})

/**
 * A routed refusal names a reason and carries no canned prose, so the browser
 * half renders the line in the user's language (the panel maps every reason
 * through `REJECTED_REASON_KEYS`; the vocabulary and its shipped copy are locked
 * in tests/locales.test.ts).
 */
describe('routed refusals carry a localized reason, not host prose', () => {
  let server: Server
  beforeAll(() => {
    server = mount(makeLlm(() => streamOf(['结果'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  /** The refusal envelope: the code, the reason, and NO message text. */
  const expectReason = (json: unknown, reason: string): void => {
    expect(json).toMatchObject({ ok: false, error: { code: 'rejected', params: { reason } } })
    expect((json as { error: { message?: unknown } }).error.message).toBeUndefined()
  }

  it('names the refusal reason for a non-JSON content type', async () => {
    const { port } = server.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${port}/prompt-enhance/enhance`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ text: '写' }),
    })
    expect(response.status).toBe(415)
    expectReason(await response.json(), 'content-type')
  })

  it('names the refusal reason for a malformed JSON body', async () => {
    const { status, json } = await call(server, 'POST', '{nope')
    expect(status).toBe(422)
    expectReason(json, 'invalid-json')
  })

  it('names the refusal reason for a well-formed body of the wrong shape', async () => {
    const { status, json } = await call(server, 'POST', JSON.stringify({ text: 42 }))
    expect(status).toBe(422)
    expectReason(json, 'invalid-body')
  })

  it('names the refusal reason when the plugin is switched off', async () => {
    const off = mount(makeLlm(() => streamOf(['x'], [{ type: 'finish', reason: { kind: 'stop' } }])), { ...CONFIG, enabled: false })
    await new Promise<void>((resolve) => off.listen(0, '127.0.0.1', resolve))
    try {
      const { status, json } = await call(off, 'POST', JSON.stringify({ text: '写' }))
      expect(status).toBe(403)
      expectReason(json, 'disabled')
    } finally {
      await new Promise<void>((resolve) => off.close(() => resolve()))
    }
  })

  // `body-too-large` is the fifth reason. Both of its paths (the Content-Length
  // fast reject and the chunked-body backstop) destroy or complete the socket by
  // design, so it is locked by the 413 status assertions above and by the
  // vocabulary check in tests/locales.test.ts rather than by reading the body.
})

/**
 * A grounded call reports which evidence layers it used; an ungrounded one keeps
 * the response shape every older host produced.
 */
describe('success envelope reports the evidence layers', () => {
  /** One session with a single user turn and a working directory. */
  const session = {
    deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: '我们在做 DSH 插件' }] }],
    header: { cwd: 'D:\\proj' },
  }
  /** A one-file workspace face: the root lists README.md. */
  const fsFace = {
    resolve: async (path: string) => ({ targetKey: '', displayPath: path }),
    listDir: async () => [{ name: 'README.md', type: 'file', target: { targetKey: 'README.md', displayPath: 'README.md' } }],
    readText: async () => '# Proj\nDSH prompt plugin',
  }

  it('reports history, workspace and the file count on a grounded call', async () => {
    const server = mount(
      makeLlm(() => streamOf(['结果'], [{ type: 'finish', reason: { kind: 'stop' } }])),
      CONFIG,
      { sessions: { get: (id: string) => (id === 's1' ? session : undefined) }, fs: fsFace },
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status, json } = await call(server, 'POST', JSON.stringify({ sessionId: 's1', text: '继续优化' }))
      expect(status).toBe(200)
      expect(json).toMatchObject({
        ok: true,
        value: { evidence: { history: true, workspace: true, files: 1 } },
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('omits the field entirely when no layer applied', async () => {
    const server = mount(makeLlm(() => streamOf(['结果'], [{ type: 'finish', reason: { kind: 'stop' } }])))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { status, json } = await call(server, 'POST', JSON.stringify({ text: '写个脚本' }))
      expect(status).toBe(200)
      // Absent, not `{ history: false, workspace: false }`: an ungrounded call
      // keeps the byte-identical shape older hosts produced, and the browser half
      // treats the field as optional in both directions.
      expect((json as { value: Record<string, unknown> }).value.evidence).toBeUndefined()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

/**
 * The webserver treats a duplicate (kind, path) pair as a composition-level
 * misconfiguration and throws. Registration therefore has to be fiber-owned:
 * teardown must hand the disposer back, or the next mount of the same plugin
 * (reload, re-link, dev watch) dies on the leaked route and takes the whole
 * entry down until the host is restarted.
 */
describe('route ownership against the webserver duplicate contract', () => {
  /** A webserver stub that behaves like the real one on collisions. */
  function strictWebServer(): { register(route: CapturedRoute): () => void; live(): string[] } {
    const owners = new Map<string, () => void>()
    return {
      register(route: CapturedRoute): () => void {
        const key = `${route.kind} ${route.path}`
        if (owners.has(key)) throw new Error(`duplicate ${route.kind} route "${route.path}"`)
        const dispose = (): void => {
          owners.delete(key)
        }
        owners.set(key, dispose)
        return dispose
      },
      live: (): string[] => [...owners.keys()],
    }
  }

  /** A stub context whose effect() records the disposer it was handed. */
  function fiberContext(webServer: unknown, teardown: (() => void)[]): unknown {
    return {
      effect(fn: () => unknown): () => void {
        const owned = fn()
        const dispose = typeof owned === 'function' ? (owned as () => void) : (): void => {}
        teardown.push(dispose)
        return dispose
      },
      get(key: string): unknown {
        if (key === 'webServer') return webServer
        if (key === 'llm') return makeLlm(() => streamOf(['角色：工程师。'], [{ type: 'finish', reason: { kind: 'stop' } }]))
        if (key === 'sessions') return { get: (): undefined => undefined }
        if (key === 'settings') return { get: (): unknown => ({ provider: 'zhipu', model: 'glm-5.3' }) }
        return undefined
      },
      inject(): void {},
      emit(): void {},
      on(): () => void {
        return () => {}
      },
    }
  }

  it('removes the route on teardown so a remount does not collide', () => {
    const webServer = strictWebServer()
    const teardown: (() => void)[] = []

    apply(fiberContext(webServer, teardown) as never, { ...DEFAULT_CONFIG })
    expect(webServer.live()).toEqual([`prefix ${ENHANCE_PREFIX}`])
    expect(teardown).toHaveLength(1)

    // Fiber disposal, e.g. the plugin is unloaded for a reload.
    for (const dispose of teardown) dispose()
    expect(webServer.live()).toEqual([])

    // The remount is the case that used to fail with a duplicate-route error.
    expect(() => apply(fiberContext(webServer, []) as never, { ...DEFAULT_CONFIG })).not.toThrow()
    expect(webServer.live()).toEqual([`prefix ${ENHANCE_PREFIX}`])
  })

  it('re-arms the route with a fresh admission gate after teardown', async () => {
    // The pre-0.2.9 WeakSet kept the first gate for the lifetime of the context,
    // so a re-mount silently inherited spent counters — a remount after a reload
    // could 429 the user's first click. Teardown now drops the route *and* the
    // ownership record, and the next mount arms a clean window.
    const webServer = strictWebServer()
    const routes: CapturedRoute[] = []
    const capturing = {
      register(route: CapturedRoute): () => void {
        const dispose = webServer.register(route)
        routes.push(route)
        return dispose
      },
    }
    const teardown: (() => void)[] = []
    const ctx = fiberContext(capturing, teardown)
    const config = { ...DEFAULT_CONFIG, rateLimitPerMinute: 1 }

    const serve = async (route: CapturedRoute, request: (server: Server) => Promise<number>): Promise<number> => {
      const server = createServer((req, res) => {
        void route.handler(req, res)
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      try {
        return await request(server)
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }

    apply(ctx as never, config)
    expect(routes).toHaveLength(1)
    await serve(routes[0]!, async (server) => {
      expect((await call(server, 'POST', JSON.stringify({ text: '第一个' }))).status).toBe(200)
      // The single slot is spent, so the route is now the rate-limit wall.
      expect((await call(server, 'POST', JSON.stringify({ text: '第二个' }))).status).toBe(429)
      return 0
    })

    for (const dispose of teardown) dispose()
    expect(webServer.live()).toEqual([])

    apply(ctx as never, config)
    expect(routes).toHaveLength(2)
    await serve(routes[1]!, async (server) => {
      const { status } = await call(server, 'POST', JSON.stringify({ text: '第三个' }))
      expect(status).toBe(200)
      return status
    })
  })
})
