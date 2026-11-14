// @vitest-environment jsdom
/**
 * The preview panel's error surface: one assertion per upstream `reason`, so a
 * wire reason whose specific fix hint is missing OR unreachable can never
 * silently degrade to the generic `error.upstream` line again.
 *
 * This is the component-level half of the regression locked in
 * `tests/locales.test.ts` (which checks the reason → dictionary-key table).
 * Here the REAL panel runs: `localizedErrorMessage` is exercised through the
 * rendered DOM with the host-shaped error the route actually sends.
 * @module tests/result-panel-error
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { EnhanceError, EnhanceResult } from '../src/shared/protocol'
import { en, zh, type PromptEnhanceKey } from '../src/client/locales'
import { ResultPanel, REJECTED_REASON_KEYS } from '../src/client/ResultPanel'
import type { PanelState } from '../src/client/ui-state'

/** Wire reasons paired with the specific copy an operator must see. */
const REASON_EXPECTATIONS: readonly { reason: string; specific: string }[] = [
  { reason: 'auth', specific: zh['error.upstream.auth'] },
  { reason: 'invalid-credential', specific: zh['error.upstream.invalidCredential'] },
  { reason: 'rate-limit', specific: zh['error.upstream.rateLimit'] },
  { reason: 'quota', specific: zh['error.upstream.quota'] },
  { reason: 'empty', specific: zh['error.upstream.empty'] },
  { reason: 'context-window', specific: zh['error.upstream.contextWindow'] },
  { reason: 'tool-call', specific: zh['error.upstream.toolCall'] },
  { reason: 'max-tokens', specific: zh['error.upstream.maxTokens'] },
  { reason: 'refused', specific: zh['error.upstream.refused'] },
]

/** Minimal zh renderer matching the shell's `t` seat (placeholders + unknown keys). */
const t = ((key: string, params?: Record<string, unknown>): string => {
  const dict = zh as Record<string, string>
  let text = dict[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.split(`{${name}}`).join(String(value))
  return text
}) as TranslateNS<'prompt-enhance'>

const renderError = (error: EnhanceError): HTMLElement => {
  const state: PanelState = { sessionId: 's1', phase: 'error', original: '旧原文', error }
  return render(<ResultPanel state={state} t={t} onApply={() => {}} onCancel={() => {}} />).container
}

describe('ResultPanel upstream error copy', () => {
  beforeEach(() => {
    // jsdom ships no clipboard; the footer's copy button must stay inert here.
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn(() => Promise.resolve()) },
      })
    } catch {
      // Non-configurable in this environment — the panel guards the absence.
    }
  })

  afterEach(() => {
    cleanup()
  })

  it.each(REASON_EXPECTATIONS.map(({ reason, specific }) => [reason, specific] as const))(
    'renders the specific fix hint for reason %s',
    (reason, specific) => {
      const container = renderError({ code: 'upstream', params: { reason } })
      expect(container.textContent).toContain(specific)
      // The generic line must NOT be what the operator reads.
      expect(container.textContent).not.toContain(zh['error.upstream'])
    },
  )

  it('keeps every specific hint distinct from the generic line', () => {
    for (const { specific } of REASON_EXPECTATIONS) {
      expect(specific).not.toBe(zh['error.upstream'])
      expect(specific.trim()).not.toBe('')
    }
  })

  it('falls back to the generic line when the reason has no shipped copy', () => {
    const container = renderError({ code: 'upstream', params: { reason: 'brand-new-reason' } })
    expect(container.textContent).toContain(zh['error.upstream'])
    for (const { specific } of REASON_EXPECTATIONS) {
      expect(container.textContent).not.toContain(specific)
    }
  })

  it('shows the provider detail as a separate line under the localized primary copy', () => {
    const container = renderError({ code: 'upstream', params: { reason: 'quota' }, message: 'provider said: 429 quota' })
    expect(container.textContent).toContain(zh['error.upstream.quota'])
    expect(container.textContent).toContain('provider said: 429 quota')
  })

  it('localizes a server-side over-length rejection through the too-long copy', () => {
    const container = renderError({ code: 'rejected', params: { count: 13000, max: 12000 } })
    const expected = zh['error.tooLong'].split('{count}').join('13000').split('{max}').join('12000')
    expect(container.textContent).toContain(expected)
  })

  it('renders the result phase with the enhanced body and the route metadata', () => {
    const result: EnhanceResult = { text: '增强后的正文', provider: 'p', model: 'm', elapsedMs: 1234 }
    const state: PanelState = { sessionId: 's1', phase: 'result', original: '旧原文', result }
    const container = render(<ResultPanel state={state} t={t} onApply={() => {}} onCancel={() => {}} />).container
    expect(container.textContent).toContain('增强后的正文')
    expect(container.textContent).toContain('1.2s')
    // An uncapped result must not carry the truncation warning.
    expect(container.textContent).not.toContain(zh['panel.truncated'])
  })

  it('warns above a capped (partial) result so it is never applied as complete', () => {
    const result: EnhanceResult = { text: '被截断的正文', provider: 'p', model: 'm', elapsedMs: 900, truncated: true }
    const state: PanelState = { sessionId: 's1', phase: 'result', original: '旧原文', result }
    const container = render(<ResultPanel state={state} t={t} onApply={() => {}} onCancel={() => {}} />).container
    expect(container.textContent).toContain(zh['panel.truncated'])
    expect(container.textContent).toContain('被截断的正文')
  })
})

describe('locale parity for the upstream keys', () => {
  it('has the same upstream key set in both dictionaries', () => {
    const upstream = Object.keys(zh).filter((key) => key.startsWith('error.upstream.')) as PromptEnhanceKey[]
    // Nine reasons, each with dedicated copy — the count the panel table expects.
    expect(upstream.sort()).toEqual(Object.keys(en).filter((key) => key.startsWith('error.upstream.')).sort())
    expect(upstream.length).toBe(REASON_EXPECTATIONS.length)
  })
})

/** Every routed refusal reason the host can send (`EnhanceRejectReason`). */
const REFUSAL_EXPECTATIONS: readonly { reason: string; specific: string }[] = [
  { reason: 'content-type', specific: zh['error.rejected.contentType'] },
  { reason: 'body-too-large', specific: zh['error.rejected.bodyTooLarge'] },
  { reason: 'invalid-json', specific: zh['error.rejected.invalidJson'] },
  { reason: 'invalid-body', specific: zh['error.rejected.invalidBody'] },
  { reason: 'disabled', specific: zh['error.disabled'] },
]

describe('ResultPanel routed-refusal copy', () => {
  afterEach(cleanup)

  it.each(REFUSAL_EXPECTATIONS.map(({ reason, specific }) => [reason, specific] as const))(
    'renders the localized line for refusal reason %s',
    (reason, specific) => {
      const container = renderError({ code: 'rejected', params: { reason } })
      expect(container.textContent).toContain(specific)
      // The generic line is what used to be all the user got.
      expect(container.textContent).not.toContain(zh['error.rejected'])
    },
  )

  it('falls back to the generic refusal line for a reason with no shipped copy', () => {
    const container = renderError({ code: 'rejected', params: { reason: 'brand-new-reason' } })
    expect(container.textContent).toContain(zh['error.rejected'])
  })

  it('keeps the over-length coercion ahead of the reason table', () => {
    const container = renderError({ code: 'rejected', params: { reason: 'invalid-body', count: 13000, max: 12000 } })
    const expected = zh['error.tooLong'].split('{count}').join('13000').split('{max}').join('12000')
    expect(container.textContent).toContain(expected)
  })

  it('maps every refusal reason through the shipped table', () => {
    for (const { reason, specific } of REFUSAL_EXPECTATIONS) {
      // The table is typed as the exact wire vocabulary; the test's own list is
      // deliberately plain strings so it can also assert an unknown reason.
      const key = (REJECTED_REASON_KEYS as Record<string, PromptEnhanceKey | undefined>)[reason]
      expect(key, `missing mapping for '${reason}'`).toBeDefined()
      expect(zh[key!]).toBe(specific)
    }
  })
})

describe('ResultPanel browser-side detail lines', () => {
  afterEach(cleanup)

  it('localizes a detail key instead of printing the raw key', () => {
    const container = renderError({ code: 'internal', detailKey: 'detail.unreachable' })
    expect(container.textContent).toContain(zh['detail.unreachable'])
    expect(container.textContent).toContain(zh['error.internal'])
    expect(container.textContent).not.toContain('detail.unreachable')
  })

  it('interpolates the detail params', () => {
    const container = renderError({ code: 'internal', detailKey: 'detail.hostStatus', params: { status: 503 } })
    expect(container.textContent).toContain(zh['detail.hostStatus'].split('{status}').join('503'))
  })

  it('ignores a key this dictionary does not ship', () => {
    const container = renderError({ code: 'internal', detailKey: 'detail.brand.new' })
    expect(container.textContent).not.toContain('detail.brand.new')
    expect(container.textContent).toContain(zh['error.internal'])
  })

  it('still shows host diagnostic text that has no key of its own', () => {
    const container = renderError({ code: 'internal', message: 'prompt-enhance: provider 与 model 必须成对填写' })
    expect(container.textContent).toContain('provider 与 model 必须成对填写')
  })
})

describe('ResultPanel evidence line', () => {
  afterEach(cleanup)

  const renderResult = (result: EnhanceResult): HTMLElement => render(
    <ResultPanel
      state={{ sessionId: 's1', phase: 'result', original: '旧原文', result }}
      t={t}
      onApply={() => {}}
      onCancel={() => {}}
    />,
  ).container

  it('names both layers and the file count', () => {
    const container = renderResult({ text: '正文', provider: 'p', model: 'm', elapsedMs: 5, evidence: { history: true, workspace: true, files: 3 } })
    expect(container.textContent).toContain(zh['panel.evidence.label'])
    expect(container.textContent).toContain(zh['panel.evidence.history'])
    expect(container.textContent).toContain(zh['panel.evidence.workspace'].split('{files}').join('3'))
  })

  it('names the workspace alone when no file excerpt was read', () => {
    const container = renderResult({ text: '正文', provider: 'p', model: 'm', elapsedMs: 5, evidence: { history: false, workspace: true, files: 0 } })
    expect(container.textContent).toContain(zh['panel.evidence.workspaceTree'])
    expect(container.textContent).not.toContain(zh['panel.evidence.history'])
  })

  it('renders no evidence line for an ungrounded call or an older host', () => {
    const container = renderResult({ text: '正文', provider: 'p', model: 'm', elapsedMs: 5 })
    expect(container.textContent).not.toContain(zh['panel.evidence.label'])
  })
})
