import { describe, expect, it } from 'vitest'
import {
  REINJECTION_HEADING,
  REPAIR_CLAUSE_HEADING,
  buildReinjectionBlock,
  buildRepairClause,
  codePointLength,
  extractAnchors,
  lengthVerdict,
  verifyAnchors,
} from '../src/shared/anchors'

/** The literal texts of an anchor list, for terse assertions. */
function texts(draft: string): string[] {
  return extractAnchors(draft).map((anchor) => anchor.text)
}

describe('extractAnchors', () => {
  it('finds the fact-shaped tokens of a draft and ignores ordinary prose', () => {
    const draft = '把 D:\\Desktop\\DSH插件\\dsh-prompt-refine\\src\\enhancer.ts 里的 enhanceText 改成支持 v1.5.2 的流式接口，参考 https://api.github.com/repos/x/y 的说明'
    const found = texts(draft)
    expect(found).toContain('D:\\Desktop\\DSH插件\\dsh-prompt-refine\\src\\enhancer.ts')
    expect(found).toContain('enhanceText')
    expect(found).toContain('v1.5.2')
    expect(found).toContain('https://api.github.com/repos/x/y')
    // Prose words are not anchors: nothing here is code-shaped.
    expect(found).not.toContain('接口')
    expect(found).not.toContain('说明')
  })

  it('records inline code without its backticks and skips fenced payloads', () => {
    const draft = '调用 `ctx.llm.stream` 即可，示例：\n```json\n{"provider":"deepseek"}\n```\n'
    const found = texts(draft)
    expect(found).toContain('ctx.llm.stream')
    // The fenced body is illustrative content, so it is claimed (protected
    // from a second claim) but never anchored itself.
    expect(found).not.toContain('deepseek')
    expect(found).not.toContain('{"provider":"deepseek"}')
  })

  it('de-duplicates by text and keeps draft order', () => {
    const draft = '先看 src/config.ts，再看 src/config.ts 与 src/enhancer.ts'
    expect(texts(draft)).toEqual(['src/config.ts', 'src/enhancer.ts'])
  })

  it('prefers the more specific matcher for overlapping spans', () => {
    // The URL is one anchor; the `0.2` inside it is not claimed separately.
    const found = texts('见 https://example.com/v0.2/docs')
    expect(found).toContain('https://example.com/v0.2/docs')
    expect(found).not.toContain('v0.2')
  })

  it('keeps quoted terms as their inner literal', () => {
    expect(texts('把「保真闸」这一层加进去')).toContain('保真闸')
    expect(texts('名称是 "route-leak fix"')).toContain('route-leak fix')
  })

  it('drops fragments shorter than the floor', () => {
    expect(texts('看 a 和 b')).toEqual([])
  })

  it('caps the anchor set', () => {
    const draft = Array.from({ length: 260 }, (_, index) => `https://example.com/a${index}`).join(' ')
    expect(extractAnchors(draft).length).toBeLessThanOrEqual(200)
  })

  it('returns nothing for an empty draft', () => {
    expect(extractAnchors('')).toEqual([])
  })
})

describe('verifyAnchors', () => {
  const anchors = extractAnchors('把 /usr/local/lib/x.ts 与 v0.2.8 保留')

  it('keeps anchors that survive verbatim', () => {
    const verdict = verifyAnchors(anchors, '请保留 /usr/local/lib/x.ts 与 v0.2.8 的写法')
    expect(verdict.total).toBe(anchors.length)
    expect(verdict.kept).toBe(anchors.length)
    expect(verdict.missing).toEqual([])
  })

  it('reports the literals a rewrite dropped', () => {
    const verdict = verifyAnchors(anchors, '请保留那个文件的路径，并使用当前版本号')
    expect(verdict.kept).toBe(0)
    expect(verdict.missing.map((anchor) => anchor.text)).toEqual(['/usr/local/lib/x.ts', 'v0.2.8'])
  })

  it('leans toward "still there" when only whitespace changed', () => {
    const spaced = extractAnchors('跑 npm run build:client 再提交')
    const verdict = verifyAnchors(spaced, '先跑 npm\nrun   build:client，再提交')
    expect(verdict.missing).toEqual([])
  })

  it('recognizes a path the model rewrapped across a line break', () => {
    const path = extractAnchors('打开 D:\\a\\b\\c.ts')
    const verdict = verifyAnchors(path, '打开 D:\\a\n\\b\\c.ts 看看')
    expect(verdict.missing).toEqual([])
  })
})

describe('repair and re-injection copy', () => {
  const missing = [
    { text: 'src/config.ts', kind: 'path' as const },
    { text: 'v0.2.8', kind: 'version' as const },
  ]

  it('names every missing literal in the repair clause and asks for a full rewrite', () => {
    const clause = buildRepairClause(missing)
    expect(clause).toContain(REPAIR_CLAUSE_HEADING)
    expect(clause).toContain('- src/config.ts')
    expect(clause).toContain('- v0.2.8')
    expect(clause).toContain('完整的改写结果')
  })

  it('builds a labeled appendix for what the model still dropped', () => {
    const block = buildReinjectionBlock(missing)
    expect(block).toContain(REINJECTION_HEADING)
    expect(block).toContain('- v0.2.8')
  })

  it('produces no appendix when nothing is missing', () => {
    expect(buildReinjectionBlock([])).toBe('')
  })
})

describe('lengthVerdict', () => {
  it('does not flag a short draft that grew into a structured prompt', () => {
    const draft = 'fix the bug'
    const output = 'x'.repeat(150)
    expect(lengthVerdict(draft, output).bloated).toBe(false)
    expect(lengthVerdict(draft, output).ratio).toBeGreaterThan(3)
  })

  it('flags a substantial draft that more than tripled', () => {
    const draft = 'x'.repeat(400)
    expect(lengthVerdict(draft, 'x'.repeat(1600)).bloated).toBe(true)
  })

  it('does not flag a rewrite that stayed close to the draft', () => {
    const draft = 'x'.repeat(400)
    expect(lengthVerdict(draft, 'x'.repeat(900)).bloated).toBe(false)
  })

  it('reports a zero ratio for an empty draft', () => {
    expect(lengthVerdict('', 'anything')).toEqual({ ratio: 0, bloated: false })
  })
})

describe('codePointLength', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(codePointLength('👍')).toBe(1)
    expect('👍'.length).toBe(2)
  })
})
