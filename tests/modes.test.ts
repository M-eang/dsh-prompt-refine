import { describe, expect, it } from 'vitest'
import {
  ENHANCE_MODES,
  MODE_SPECS,
  isEnhanceMode,
  modeSystemAddon,
  resolveMaxTokens,
} from '../src/shared/modes'

describe('ENHANCE_MODES', () => {
  it('lists the seven modes in render order', () => {
    expect(ENHANCE_MODES).toEqual(['standard', 'concise', 'spec', 'engineering', 'colloquial', 'research', 'creative'])
  })

  it('keeps standard as the identity mode', () => {
    // standard 必须完全等于历史行为：不加词、不设上限。
    // 这一条如果红了，等于偷偷改了所有老用户的输出与提示词。
    expect(MODE_SPECS.standard.systemAddon).toBe('')
    expect(MODE_SPECS.standard.maxOutputTokens).toBe(0)
  })

  it('gives every non-default mode real discipline and a budget', () => {
    for (const mode of ['concise', 'spec', 'engineering', 'colloquial', 'research', 'creative'] as const) {
      expect(MODE_SPECS[mode].systemAddon.length).toBeGreaterThan(40)
      expect(MODE_SPECS[mode].maxOutputTokens).toBeGreaterThan(0)
    }
  })

  it('gives every mode an addon that names itself', () => {
    // 七个档位各是一种交付形态；纪律文本必须自报档位，否则两档在日志里分不出来。
    for (const mode of ['concise', 'spec', 'engineering', 'colloquial', 'research', 'creative'] as const) {
      expect(MODE_SPECS[mode].systemAddon).toContain(`Mode: ${mode}.`)
    }
  })

  it('never lets a mode addon lift the built-in hard rules out of the prompt', () => {
    // 只追加纪律，不出现"忽略上面的规则"这类指令。
    for (const spec of Object.values(MODE_SPECS)) {
      expect(spec.systemAddon.toLowerCase()).not.toContain('ignore the rules above')
      expect(spec.systemAddon).not.toContain('忽略上面')
    }
  })
})

describe('isEnhanceMode', () => {
  it('accepts exactly the known ids', () => {
    for (const mode of ENHANCE_MODES) expect(isEnhanceMode(mode)).toBe(true)
  })

  it('rejects anything else, including empty and non-strings', () => {
    for (const value of ['', 'Standard', 'concise ', 'verbose', 1, null, undefined, {}]) {
      expect(isEnhanceMode(value)).toBe(false)
    }
  })
})

describe('modeSystemAddon', () => {
  it('returns the addon of a known mode', () => {
    expect(modeSystemAddon('spec')).toBe(MODE_SPECS.spec.systemAddon)
    expect(modeSystemAddon('concise')).toBe(MODE_SPECS.concise.systemAddon)
  })

  it('reads an absent or unknown stored value as the identity mode', () => {
    // 旧配置里没有这个字段：升级后行为必须与升级前逐字节相同。
    expect(modeSystemAddon(undefined)).toBe('')
    expect(modeSystemAddon('verbose' as never)).toBe('')
  })
})

describe('resolveMaxTokens', () => {
  it('lets an explicit positive cap win over the mode budget', () => {
    expect(resolveMaxTokens(4096, 'concise')).toBe(4096)
    expect(resolveMaxTokens(4096, 'spec')).toBe(4096)
    expect(resolveMaxTokens(1, 'standard')).toBe(1)
  })

  it('falls back to the mode budget when the operator sends no cap', () => {
    expect(resolveMaxTokens(0, 'concise')).toBe(2000)
    expect(resolveMaxTokens(0, 'spec')).toBe(8000)
    expect(resolveMaxTokens(0, 'standard')).toBe(0)
  })

  it('treats a nonsense explicit value like no cap', () => {
    expect(resolveMaxTokens(Number.NaN, 'concise')).toBe(2000)
    expect(resolveMaxTokens(-5, 'spec')).toBe(8000)
    // 非有限数（手改出的 Infinity）同样按"没填"处理，回落到档位预算。
    expect(resolveMaxTokens(Number.POSITIVE_INFINITY, 'spec')).toBe(8000)
  })

  it('sends no cap for an unknown mode', () => {
    expect(resolveMaxTokens(0, undefined)).toBe(0)
    expect(resolveMaxTokens(0, 'verbose' as never)).toBe(0)
  })
})
