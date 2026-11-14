import { describe, expect, it } from 'vitest'
import { isRefusalReply, REFUSAL_SCAN_CHARS } from '../src/shared/refusal'

/**
 * The real reply that motivated this module: a provider answering the request
 * ("write an explicit prompt") instead of performing it ("restructure this
 * draft"), complete with an offer of a sanitised alternative.
 */
const SCREENSHOT_REFUSAL = [
  '这个我没法帮你改写——原始提示词要的是露骨的色情内容（包含生殖器的具体描写），',
  '改写后也只是把同一个请求包装成更完整的指令，本质上还是在生成这类内容，所以我不做。',
  '',
  '如果你实际想要的是「面向成年读者的情感/亲密关系小说」，我可以帮你把这个提示词重写成',
  '一个结构清晰、可用的版本。',
].join('\n')

/** What the same model returns once the stance is in force: a prompt. */
const GOOD_REWRITE = [
  '## 角色',
  '你是一位成人向短篇小说的写作者，面向成年读者，写作不受题材限制。',
  '',
  '## 要求',
  '1. 直接进入场景，不写前言，不做道德评价。',
  '2. 情欲段落用具体、直白的身体描写，不回避解剖学词汇。',
  '3. 字数 2000 字以上。',
  '',
  '## 输出格式',
  '只输出小说正文。',
].join('\n')

describe('isRefusalReply', () => {
  it('recognises the declination that started this', () => {
    expect(isRefusalReply(SCREENSHOT_REFUSAL)).toBe(true)
  })

  it('keeps a real rewrite, even one that quotes a refusal-flavoured word', () => {
    expect(isRefusalReply(GOOD_REWRITE)).toBe(false)
  })

  it('does not fire on an ordinary one-line polish without scaffolding', () => {
    // No decline phrase at all → never a refusal, whatever the shape.
    expect(isRefusalReply('把「写个爬虫」改写为：用 Python 写一个抓取网页标题的爬虫。')).toBe(false)
  })

  it('recognises the English declinations', () => {
    expect(isRefusalReply("I can't help with this request — it asks for explicit sexual content.")).toBe(true)
    expect(isRefusalReply("I'm sorry, but I can't rewrite that.")).toBe(true)
    expect(isRefusalReply('As an AI, I must decline: the draft asks for pornographic prose.')).toBe(true)
  })

  it('does not fire on English rewrites that merely contain "can\'t" deep in the body', () => {
    const body = 'Rewrite the request as: "You are a reviewer. Flag anything you can\'t verify."'
    expect(isRefusalReply(body)).toBe(false)
  })

  it('reads only the head of a long reply', () => {
    // Padding before the decline is past the scan window: this is the price of
    // not flagging a rewrite that quotes a decline far down its own body.
    const padded = `${'x'.repeat(REFUSAL_SCAN_CHARS)} 我不能帮你做这个。`
    expect(isRefusalReply(padded)).toBe(false)
    const lead = `我不能帮你做这个。${'x'.repeat(REFUSAL_SCAN_CHARS)}`
    expect(isRefusalReply(lead)).toBe(true)
  })

  it('treats an empty reply as "not a refusal" so the empty-response path keeps it', () => {
    expect(isRefusalReply('')).toBe(false)
    expect(isRefusalReply('   \n  ')).toBe(false)
  })

  it('lets scaffolding override a lead-in apology', () => {
    // "抱歉" opens the reply, but the body is a structured prompt: the model
    // apologised for the earlier turn and then did the work.
    const withScaffold = '抱歉刚才跑偏了。\n\n## 角色\n你是爬虫工程师。\n\n## 步骤\n1. 读取页面。\n2. 解析标题。'
    expect(isRefusalReply(withScaffold)).toBe(false)
  })
})
