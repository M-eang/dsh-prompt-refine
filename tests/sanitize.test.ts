import { describe, expect, it } from 'vitest'
import { sanitizeOutput } from '../src/shared/sanitize'

describe('sanitizeOutput — wrapping quotes', () => {
  it('strips one layer of a pair that wraps the whole text', () => {
    expect(sanitizeOutput('"角色：翻译"')).toBe('角色：翻译')
    expect(sanitizeOutput('“角色：翻译”')).toBe('角色：翻译')
    expect(sanitizeOutput('「角色：翻译」')).toBe('角色：翻译')
    expect(sanitizeOutput('『角色：翻译』')).toBe('角色：翻译')
  })

  it('leaves a double wrap alone (the inner still carries the same quote)', () => {
    // `""x""` 内部还有同形引号，无法与"两句引号并列"区分，因此不动。
    expect(sanitizeOutput('""角色：翻译""')).toBe('""角色：翻译""')
  })

  it('leaves two parallel quoted fragments alone', () => {
    // 首尾同形但其实是两对引号 —— 剥掉就会毁掉正文，必须原样保留。
    expect(sanitizeOutput('"a" 和 "b"')).toBe('"a" 和 "b"')
  })

  it('leaves quotes that are part of the body alone', () => {
    // 正文内部、只有一个引号、或是代码里的引号，都不是"包裹"。
    expect(sanitizeOutput('把 "foo" 改成 "bar"，保持其余不变')).toBe('把 "foo" 改成 "bar"，保持其余不变')
    expect(sanitizeOutput('"未闭合的引号')).toBe('"未闭合的引号')
    expect(sanitizeOutput("const a = 'x'")).toBe("const a = 'x'")
  })

  it('does not strip when the closing quote is elsewhere', () => {
    expect(sanitizeOutput('“角色：翻译\n第二行”')).toBe('角色：翻译\n第二行')
    expect(sanitizeOutput('「角色：翻译')).toBe('「角色：翻译')
  })
})

describe('sanitizeOutput — leading meta lines', () => {
  it('drops a Chinese announcement line', () => {
    expect(sanitizeOutput('以下是优化后的提示词：\n角色：翻译')).toBe('角色：翻译')
  })

  it('drops an English announcement line', () => {
    expect(sanitizeOutput("Here's the enhanced prompt:\nRole: translator")).toBe('Role: translator')
    expect(sanitizeOutput('Rewritten prompt:\nRole: translator')).toBe('Role: translator')
  })

  it('drops at most two, never all of the text', () => {
    expect(sanitizeOutput('以下是优化后的提示词：\n优化后版本：\n角色：翻译')).toBe('角色：翻译')
    expect(sanitizeOutput('以下是优化后的提示词：\n以下是改写后结果：\n以下是另一行：\n角色：翻译'))
      .toBe('以下是另一行：\n角色：翻译')
  })

  it('keeps a first line that is prose, not an announcement', () => {
    const text = '帮我把下面的中文翻译成英文：\n角色：翻译'
    expect(sanitizeOutput(text)).toBe(text)
  })

  it('keeps an announcement-looking body when it is all there is', () => {
    expect(sanitizeOutput('以下是优化后的提示词：')).toBe('以下是优化后的提示词：')
  })
})

describe('sanitizeOutput — trailing shell', () => {
  it('drops a trailing separator rule', () => {
    expect(sanitizeOutput('角色：翻译\n---')).toBe('角色：翻译')
    expect(sanitizeOutput('角色：翻译\n=== ')).toBe('角色：翻译')
  })

  it('drops a trailing courtesy line (zh and en)', () => {
    expect(sanitizeOutput('角色：翻译\n希望这有帮助！')).toBe('角色：翻译')
    expect(sanitizeOutput('Role: translator\nHope this helps!')).toBe('Role: translator')
    expect(sanitizeOutput('Role: translator\nLet me know if you need changes.')).toBe('Role: translator')
  })

  it('keeps a separator inside the body', () => {
    // markdown 的分隔线在正文中间，必须原样保留。
    const text = '第一部分\n---\n第二部分'
    expect(sanitizeOutput(text)).toBe(text)
  })

  it('keeps a courtesy-looking last line when it is all there is', () => {
    expect(sanitizeOutput('希望这有帮助！')).toBe('希望这有帮助！')
  })
})

describe('sanitizeOutput — no-ops', () => {
  it('returns an already-clean body unchanged', () => {
    const text = '角色：Python 工程师\n\n要求：\n1. 写出可运行的代码\n2. 解释关键取舍'
    expect(sanitizeOutput(text)).toBe(text)
  })

  it('keeps a fenced body intact (stripping fences is normalizeOutput\'s job)', () => {
    const text = '```ts\nconst a = "x"\n```'
    expect(sanitizeOutput(text)).toBe(text)
  })

  it('keeps interior quotes and blank lines', () => {
    const text = '用「张三」这个名字\n\n并且保留 "v1.2.3" 的写法'
    expect(sanitizeOutput(text)).toBe(text)
  })
})
