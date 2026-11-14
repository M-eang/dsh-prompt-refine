/**
 * Tests of the built-in template library (`shared/templates.ts`): the closed id
 * list, one real discipline per template, and the two resolution rules that
 * decide whether a stored or per-call value becomes an addon at all.
 *
 * The companion contract lives in `tests/modes.test.ts`: both addons are
 * appended to the same system prompt, so the properties asserted here — no
 * lifted hard rules, no copy-paste addon, fidelity restated — must hold for
 * templates exactly as they do for modes.
 * @module tests/templates
 */

import { describe, expect, it } from 'vitest'
import {
  ENHANCE_TEMPLATES,
  TEMPLATE_SPECS,
  isEnhanceTemplate,
  resolveTemplateId,
  templateSystemAddon,
} from '../src/shared/templates'

describe('ENHANCE_TEMPLATES', () => {
  it('lists the six built-ins in selector order', () => {
    expect(ENHANCE_TEMPLATES).toEqual([
      'code-review',
      'bug-report',
      'weekly-report',
      'api-doc',
      'test-plan',
      'refactor',
    ])
  })

  it('gives every template real discipline', () => {
    for (const id of ENHANCE_TEMPLATES) {
      expect(TEMPLATE_SPECS[id].systemAddon.length).toBeGreaterThan(80)
    }
  })

  it('never lets a template addon lift the built-in hard rules out of the prompt', () => {
    for (const spec of Object.values(TEMPLATE_SPECS)) {
      expect(spec.systemAddon.toLowerCase()).not.toContain('ignore the rules above')
      expect(spec.systemAddon).not.toContain('忽略上面')
    }
  })

  it('restates the fidelity rule in every addon', () => {
    // 模板最容易犯的错就是为了填充标题而编造内容：每条都必须带上"不编造"。
    for (const spec of Object.values(TEMPLATE_SPECS)) {
      expect(spec.systemAddon.toLowerCase()).toContain('invent')
    }
  })

  it('keeps the addons distinct', () => {
    const addons = ENHANCE_TEMPLATES.map((id) => TEMPLATE_SPECS[id].systemAddon)
    expect(new Set(addons).size).toBe(addons.length)
  })
})

describe('isEnhanceTemplate', () => {
  it('accepts exactly the known ids', () => {
    for (const id of ENHANCE_TEMPLATES) expect(isEnhanceTemplate(id)).toBe(true)
  })

  it('rejects anything else, including empty and non-strings', () => {
    for (const value of ['', 'CODE-REVIEW', 'code-review ', 'summary', 'none', 1, null, undefined, {}]) {
      expect(isEnhanceTemplate(value)).toBe(false)
    }
  })
})

describe('templateSystemAddon', () => {
  it('returns the addon of a known template', () => {
    expect(templateSystemAddon('api-doc')).toBe(TEMPLATE_SPECS['api-doc'].systemAddon)
    expect(templateSystemAddon('refactor')).toBe(TEMPLATE_SPECS.refactor.systemAddon)
  })

  it('reads an absent or unknown stored value as no template', () => {
    // 旧配置里没有这个字段：升级后行为必须与升级前逐字节相同。
    expect(templateSystemAddon(undefined)).toBe('')
    expect(templateSystemAddon(null)).toBe('')
    expect(templateSystemAddon('')).toBe('')
    expect(templateSystemAddon('summary')).toBe('')
  })
})

describe('resolveTemplateId', () => {
  it('lets a per-call override win over the stored default', () => {
    expect(resolveTemplateId('api-doc', 'code-review')).toBe('code-review')
  })

  it('uses the stored default when no override is given', () => {
    expect(resolveTemplateId('api-doc', undefined)).toBe('api-doc')
    expect(resolveTemplateId('api-doc', '')).toBe('api-doc')
  })

  it('ignores an unknown override rather than losing a valid default', () => {
    expect(resolveTemplateId('api-doc', 'summary')).toBe('api-doc')
  })

  it('resolves to undefined when neither side names a known template', () => {
    expect(resolveTemplateId('', undefined)).toBeUndefined()
    expect(resolveTemplateId(undefined, undefined)).toBeUndefined()
    expect(resolveTemplateId('', 'bogus')).toBeUndefined()
    expect(resolveTemplateId('bogus', 'bogus')).toBeUndefined()
  })
})
