/**
 * 输出净化的第二道防线（在 `normalizeOutput` 里去围栏之后、折叠空行之前跑）。
 *
 * 系统提示词已经要求"只输出提示词本体"，但实测仍会漏出三类壳：
 * ① 整体被引号包住（模型把结果当成"引用一句话"）；
 * ② 开头一行说明（"以下是优化后的提示词："）；
 * ③ 结尾一行客套或分隔线（"希望有帮助"、`---`）。
 *
 * 这里是**确定性**清理，不调用模型：只吃掉"整段被包裹"与"独立成行的壳"，
 * 绝不改动正文内部的同类字符 —— 一段代码里的引号、markdown 里的 `---`
 * 分隔线（不在首尾）都必须原样保留。清理后若什么都不剩，则保留原样。
 * @module dsh-prompt-refine/shared/sanitize
 */

/** 成对的包裹引号（首尾各一个，整体包裹）。 */
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ['“', '”'],
  ['「', '」'],
  ['『', '』'],
  ['‘', '’'],
]

/** 开头一行的"说明壳"（中文）：整行只是介绍，不含正文。 */
const META_LINE_ZH = /^\s*(?:以下|下面|这里|这是|以下是|如上|优化后|改写后|重写后|增强后)[^\n]{0,40}?(?:提示词|prompt|版本|结果)[^\n]{0,12}[：:]\s*$/i
/** 开头一行的"说明壳"（英文）。 */
const META_LINE_EN = /^\s*(?:here(?:'s| is)|below is|the (?:rewritten|optimized|enhanced) (?:prompt|version)|rewritten prompt|optimized prompt|enhanced prompt)\b[^\n]{0,60}[：:]\s*$/i
/** 结尾一行：纯分隔线。 */
const TRAILING_RULE = /^\s*[-=*_~—]{3,}\s*$/
/** 结尾一行：客套话（"希望有帮助" / "if you need…"）。 */
const TRAILING_COURTESY = /^\s*(?:希望|以上|如需|如果|有需要)[^\n]{0,40}(?:帮助|调整|补充|修改|告知|告诉我)[^\n]{0,20}[。!！.～~]?\s*$/i
const TRAILING_COURTESY_EN = /^\s*(?:hope (?:this|it) helps|let me know if|feel free to)[^\n]{0,60}$/i

const splitLines = (text: string): string[] => text.split('\n')

/**
 * 只吃掉一层包裹引号：首字符与尾字符构成同一对、长度 ≥ 2，且**内部不再出现
 * 闭合引号**。最后这条是关键：`"a" 和 "b"` 这种首尾同形但其实是两对引号的
 * 句子，一旦被剥掉就会毁掉正文 —— 宁可漏清，不可错清。
 * @param text - 已 trimmed 的文本。
 * @returns 去掉一层包裹引号后的文本（不满足条件时原样返回）。
 */
function stripWrappingQuotes(text: string): string {
  if (text.length < 2) return text
  for (const [open, close] of QUOTE_PAIRS) {
    if (!text.startsWith(open) || !text.endsWith(close)) continue
    const inner = text.slice(open.length, text.length - close.length)
    if (inner.trim() === '') continue
    if (inner.includes(close)) continue
    return inner.trim()
  }
  return text
}

/**
 * 净化一段模型输出。顺序：包裹引号 → 开头说明行（最多两行）→
 * 结尾客套/分隔线（可叠加多行）。任一步骤会把文本吃空时，该步不生效。
 * @param raw - 模型输出（已去围栏、已 trimmed）。
 * @returns 净化后的正文。
 */
export function sanitizeOutput(raw: string): string {
  let text = stripWrappingQuotes(raw.trim())
  if (text === '') return raw.trim()

  // 开头说明行：最多吃两行，且必须还剩正文。
  for (let eaten = 0; eaten < 2; eaten += 1) {
    const lines = splitLines(text)
    if (lines.length < 2) break
    const first = lines[0] ?? ''
    if (!META_LINE_ZH.test(first) && !META_LINE_EN.test(first)) break
    const rest = lines.slice(1).join('\n').replace(/^\s*\n+/u, '')
    if (rest.trim() === '') break
    text = rest
  }

  // 结尾客套 / 分隔线：同样最多两行，且必须还剩正文。
  for (let eaten = 0; eaten < 2; eaten += 1) {
    const lines = splitLines(text)
    if (lines.length < 2) break
    const last = lines[lines.length - 1] ?? ''
    if (!TRAILING_RULE.test(last) && !TRAILING_COURTESY.test(last) && !TRAILING_COURTESY_EN.test(last)) break
    const rest = lines.slice(0, -1).join('\n').replace(/\n+\s*$/u, '')
    if (rest.trim() === '') break
    text = rest
  }

  return text.trim()
}
