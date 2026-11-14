import { describe, expect, it } from 'vitest'
import { hasRefs, protectRefs, restoreRefs } from '../src/shared/refs'

describe('protectRefs', () => {
  it('leaves a draft without references byte-identical', () => {
    const text = '帮我把这段提示词改好，然后给我三个版本'
    expect(protectRefs(text)).toEqual({ body: text, refs: [] })
  })

  it('replaces a file reference with the first placeholder', () => {
    expect(protectRefs('看 @src/app.ts 有没有泄漏')).toEqual({
      body: '看 ⟦1⟧ 有没有泄漏',
      refs: [{ kind: 'at', text: '@src/app.ts' }],
    })
  })

  it('keeps a quoted path with spaces whole', () => {
    // 宿主对含空格的路径只给得出引号形态，它是唯一可表示的写法。
    expect(protectRefs('总结 @"my notes/2026 plan.md" 的结论')).toEqual({
      body: '总结 ⟦1⟧ 的结论',
      refs: [{ kind: 'at', text: '@"my notes/2026 plan.md"' }],
    })
  })

  it('numbers references in draft order across both kinds', () => {
    expect(protectRefs('/code-review 按 @docs/api.md 的约定再走一遍')).toEqual({
      body: '⟦1⟧ 按 ⟦2⟧ 的约定再走一遍',
      refs: [
        { kind: 'slash', text: '/code-review' },
        { kind: 'at', text: '@docs/api.md' },
      ],
    })
  })

  it('protects a reference glued to Chinese text', () => {
    expect(protectRefs('看@src/app.ts哪里慢')).toEqual({
      body: '看⟦1⟧哪里慢',
      refs: [{ kind: 'at', text: '@src/app.ts' }],
    })
  })

  it('stops at Chinese punctuation instead of swallowing the sentence', () => {
    expect(protectRefs('看 @app.ts，然后重构')).toEqual({
      body: '看 ⟦1⟧，然后重构',
      refs: [{ kind: 'at', text: '@app.ts' }],
    })
  })

  it('leaves the sentence-final period in the prose', () => {
    expect(protectRefs('参考 @app.ts.')).toEqual({
      body: '参考 ⟦1⟧.',
      refs: [{ kind: 'at', text: '@app.ts' }],
    })
  })

  it('never mistakes an email address for a reference', () => {
    const text = '发给 dev@example.com 一封信'
    expect(protectRefs(text)).toEqual({ body: text, refs: [] })
  })

  it('never mistakes a URL for a slash reference', () => {
    const text = '抓 https://example.com/api/v1/items 的数据'
    expect(protectRefs(text)).toEqual({ body: text, refs: [] })
  })

  it('never mistakes an absolute path for a command', () => {
    const text = '打开 /home/user/a.txt 看看'
    expect(protectRefs(text)).toEqual({ body: text, refs: [] })
  })

  it('never mistakes and/or for a slash reference', () => {
    const text = '把 bool and/or int 都接受'
    expect(protectRefs(text)).toEqual({ body: text, refs: [] })
  })

  it('protects the same reference twice as two placeholders', () => {
    // 重复出现是用户的选择；两处都要还原，不然第二处就静默丢了。
    expect(protectRefs('@a.ts 和 @a.ts 对比')).toEqual({
      body: '⟦1⟧ 和 ⟦2⟧ 对比',
      refs: [
        { kind: 'at', text: '@a.ts' },
        { kind: 'at', text: '@a.ts' },
      ],
    })
  })
})

describe('restoreRefs', () => {
  const draft = '/code-review 按 @docs/api.md 与 @"my plan.md" 重写'
  const { refs } = protectRefs(draft)

  it('round-trips a rewrite that kept every placeholder', () => {
    const protectedBody = protectRefs(draft).body
    expect(restoreRefs(protectedBody, refs)).toEqual({ text: draft, missing: [] })
  })

  it('restores in place, keeping the model’s own wording around them', () => {
    const passed = '⟦1⟧ 的步骤：先按 ⟦2⟧ 核对接口，再照 ⟦3⟧ 的排期重写一遍。'
    expect(restoreRefs(passed, refs)).toEqual({
      text: '/code-review 的步骤：先按 @docs/api.md 核对接口，再照 @"my plan.md" 的排期重写一遍。',
      missing: [],
    })
  })

  it('accepts the placeholder spellings a model drifts into', () => {
    expect(restoreRefs('【1】 看 `⟦2⟧` 与 〔3〕', refs).text).toBe('/code-review 看 @docs/api.md 与 @"my plan.md"')
  })

  it('re-appends a reference whose placeholder was dropped', () => {
    const restored = restoreRefs('⟦1⟧ 走一遍，其余照旧', refs)
    expect(restored.missing).toEqual([
      { kind: 'at', text: '@docs/api.md' },
      { kind: 'at', text: '@"my plan.md"' },
    ])
    expect(restored.text.endsWith('\n\n@docs/api.md @"my plan.md"')).toBe(true)
  })

  it('sweeps a duplicated placeholder instead of leaking it to the user', () => {
    // 模型把 ⟦2⟧ 写成了 ⟦1⟧：第二处必须补回原文，不能把占位符交给用户，
    // 也不能让第二条引用凭空消失。
    const twin = protectRefs('@a.ts 与 @a.ts').refs
    const restored = restoreRefs('⟦1⟧ 和 ⟦1⟧', twin)
    expect(restored.text).toBe('@a.ts 和 @a.ts')
    expect(restored.missing).toEqual([])
    expect(restored.text).not.toContain('⟦')
  })

  it('deletes a placeholder number it cannot resolve', () => {
    const one = protectRefs('看 @docs/api.md').refs
    expect(restoreRefs('⟦1⟧ ⟦9⟧ 收尾', one).text).toBe('@docs/api.md  收尾')
  })

  it('leaves a Markdown link alone', () => {
    // `[1]` 是脚注/链接，不是占位符：认错就会把正文改坏。
    const one = protectRefs('看 @docs/api.md').refs
    expect(restoreRefs('见 [1] 与 ⟦1⟧', one).text).toBe('见 [1] 与 @docs/api.md')
  })

  it('is a no-op when there were no references', () => {
    expect(restoreRefs('普通改写结果', [])).toEqual({ text: '普通改写结果', missing: [] })
  })
})

describe('hasRefs', () => {
  it('reports whether a draft carries any host reference', () => {
    expect(hasRefs('普通草稿')).toBe(false)
    expect(hasRefs('看 @a.ts')).toBe(true)
    expect(hasRefs('/skill 帮我改')).toBe(true)
  })
})
