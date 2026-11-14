// @vitest-environment jsdom
/**
 * Component-level tests of the Plugins-panel configuration page.
 *
 * The panel hands the page its namespace read and its write seat as props, so
 * the suite drives the real component with a fake seat. What matters here is
 * the page's own contract: it stages edits locally, converts them into the wire
 * operations the host's `configForms.mutate` takes, writes them with the
 * revision it was given, and never claims a success the host refused. The page
 * imports no other Client package, so nothing else needs a double.
 * @module tests/settings-card
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SettingsCard, type SettingsFormSnapshot } from '../src/client/SettingsCard'
import { zh } from '../src/client/locales'

/** The dictionary reader the panel hands a page, without the locale service. */
const t = ((key: string, params?: Record<string, unknown>): string => {
  let s = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) s = s.split(`{${name}}`).join(String(value))
  return s
}) as TranslateNS<'prompt-enhance'>

/** A fake namespace read/write seat, with values for a working deployment. */
function makeSeat(overrides: Partial<SettingsFormSnapshot> = {}) {
  const mutate = vi.fn(async (_ops: unknown, _revision?: number) => true)
  const state: SettingsFormSnapshot = {
    status: 'ready',
    revision: 7,
    writable: true,
    mode: 'host',
    base: { enabled: true, temperature: 0.3 },
    user: {},
    value: { enabled: true, temperature: 0.3 },
    ...overrides,
  }
  return { mutate, seat: { state, mutate } }
}

/** The control the save button is, with its disabled state readable. */
function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: zh['settings.save'] }) as HTMLButtonElement
}

afterEach(() => {
  cleanup()
})

describe('SettingsCard', () => {
  it('renders the one-line summary the panel asks for', () => {
    const { seat } = makeSeat()
    render(<SettingsCard t={t} view="summary" form={seat} />)
    expect(screen.getByText(zh['settings.summary'])).toBeTruthy()
  })

  it('says so when the host has no seat for the namespace', () => {
    render(<SettingsCard t={t} />)
    expect(screen.getByText(zh['settings.unavailable'])).toBeTruthy()
  })

  it('says it is waiting while the mirror has no answer yet', () => {
    const { seat } = makeSeat({ status: 'loading' })
    render(<SettingsCard t={t} form={seat} />)
    expect(screen.getByText(zh['settings.saving'])).toBeTruthy()
  })

  it('renders one control per schema field, with the effective values', () => {
    const { seat } = makeSeat()
    render(<SettingsCard t={t} form={seat} />)
    expect((screen.getByLabelText(zh['settings.field.enabled.label']) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(zh['settings.field.temperature.label']) as HTMLInputElement).value).toBe('0.3')
    expect((screen.getByLabelText(zh['settings.field.strategyMode.label']) as HTMLSelectElement).value).toBe('')
    expect(saveButton().disabled).toBe(true)
  })

  it('writes the staged batch with the revision it was handed', async () => {
    const { mutate, seat } = makeSeat()
    render(<SettingsCard t={t} form={seat} />)
    const box = screen.getByLabelText(zh['settings.field.fidelity.label']) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    await act(async () => {
      fireEvent.click(saveButton())
    })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toEqual([{ op: 'set', path: ['fidelity'], value: true }])
    expect(mutate.mock.calls[0][1]).toBe(7)
  })

  it('refuses to save an unusable draft and points at the field', () => {
    const { mutate, seat } = makeSeat()
    render(<SettingsCard t={t} form={seat} />)
    fireEvent.change(screen.getByLabelText(zh['settings.field.temperature.label']), { target: { value: 'hot' } })
    expect(screen.getAllByText(zh['settings.invalid']).length).toBe(1)
    expect(saveButton().disabled).toBe(true)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('keeps the draft and reports a write the host refused', async () => {
    const { mutate, seat } = makeSeat()
    mutate.mockResolvedValue(false)
    render(<SettingsCard t={t} form={seat} />)
    const input = screen.getByLabelText(zh['settings.field.temperature.label']) as HTMLInputElement
    fireEvent.change(input, { target: { value: '0.5' } })
    await act(async () => {
      fireEvent.click(saveButton())
    })
    expect(screen.getByRole('alert').textContent).toBe(zh['settings.saveFailed'])
    expect(input.value).toBe('0.5')
    expect(saveButton().disabled).toBe(false)
  })

  it('drops a staged edit on discard without touching the host', () => {
    const { mutate, seat } = makeSeat()
    render(<SettingsCard t={t} form={seat} />)
    const input = screen.getByLabelText(zh['settings.field.temperature.label']) as HTMLInputElement
    fireEvent.change(input, { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('button', { name: zh['settings.discard'] }))
    expect(input.value).toBe('0.3')
    expect(saveButton().disabled).toBe(true)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('offers the reset control for an overridden field and clears it', async () => {
    const { mutate, seat } = makeSeat({ user: { temperature: 0.5 }, value: { enabled: true, temperature: 0.5 } })
    render(<SettingsCard t={t} form={seat} />)
    const reset = screen.getByRole('button', { name: zh['settings.reset'] })
    fireEvent.click(reset)
    await act(async () => {
      fireEvent.click(saveButton())
    })
    expect(mutate.mock.calls[0][0]).toEqual([{ op: 'unset', path: ['temperature'] }])
  })

  it('shows the mode and template enums in the reader\'s language', () => {
    // 选项值必须是 id（写回配置用的），可见文字必须是本地化标签：
    // 直接摊开 `engineering` 会让设置页看起来像配置文件。
    const { seat } = makeSeat()
    render(<SettingsCard t={t} form={seat} />)
    const mode = screen.getByLabelText(zh['settings.field.mode.label']) as HTMLSelectElement
    const modeOptions = Array.from(mode.options).map((o) => [o.value, o.textContent] as const)
    expect(modeOptions).toContainEqual(['engineering', zh['settings.mode.engineering']])
    expect(modeOptions).toContainEqual(['colloquial', zh['settings.mode.colloquial']])
    const template = screen.getByLabelText(zh['settings.field.template.label']) as HTMLSelectElement
    const templateOptions = Array.from(template.options).map((o) => o.textContent)
    expect(templateOptions).toContain(zh['settings.template.code-review'])
  })

  it('disables every control on a read-only deployment', () => {
    const { seat } = makeSeat({ writable: false })
    render(<SettingsCard t={t} form={seat} />)
    expect(screen.getByText(zh['settings.readOnly'])).toBeTruthy()
    expect((screen.getByLabelText(zh['settings.field.enabled.label']) as HTMLInputElement).disabled).toBe(true)
    expect(saveButton().disabled).toBe(true)
  })
})
