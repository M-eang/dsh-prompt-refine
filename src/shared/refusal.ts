/**
 * Recognising a refusal.
 *
 * The enhancement call asks a model to rewrite a draft. Some providers answer
 * the *request* instead of performing it: they decline, lecture, or offer a
 * sanitised alternative ("我没法帮你改写…如果你实际想要的是…"). That reply is
 * not a rewrite, and handing it to the panel as the enhanced text is worse than
 * failing — the user would be looking at a policy statement where their prompt
 * should be.
 *
 * This module answers one question, cheaply and deterministically: does this
 * text read as a refusal (or a lecture about the request) rather than as a
 * written instruction? It is a heuristic, deliberately conservative, and its
 * only consumers are (a) one automatic retry under a firmer stance and (b) a
 * terminal `refused` error. A false positive therefore costs one extra call; it
 * never silently rewrites a result the user never saw.
 * @module dsh-prompt-refine/shared/refusal
 */

/**
 * How much of a reply is inspected. Refusals lead — they announce themselves in
 * the first sentence or two — while a rewritten prompt can legitimately quote
 * "抱歉" deep inside its own body, so scanning the whole text would only add
 * false positives.
 */
export const REFUSAL_SCAN_CHARS = 240

/**
 * Phrases that appear in a declination and essentially nowhere in a rewritten
 * prompt. Chinese first (the refusals this was built for), English second.
 */
const DECLINE_PATTERNS: readonly RegExp[] = [
  // 「我没法/无法/不能 + 动作」——「我没法帮你改写」是最常见的那一句
  /(?:我|咱|本人)(?:没办法|没法|无法|不能|不会|不便|不应该|不该|不做|不写)/,
  /无法(?:协助|提供|帮助|帮你|满足|完成|生成|处理|改写|输出|继续)/,
  /不能(?:协助|提供|帮助|帮你|满足|完成|生成|处理|改写|输出|参与)/,
  /没办法(?:帮你|协助|提供|完成|生成)/,
  /(?:所以|因此)(?:我)?(?:不做|不写|不参与|不提供)/,
  // 政策口吻
  /(?:涉及|属于|包含)(?:敏感|成人|色情|露骨|违规|不当)(?:内容|题材|描写)?/,
  /(?:违反|不符合|触犯)(?:规定|政策|准则|规范|条款)/,
  /(?:出于|基于)(?:安全|伦理|道德|合规)(?:考虑|原因|要求)/,
  // 替代方案与劝退
  /如果你(?:实际|真正|确实)?(?:想要|需要)的是/,
  /(?:我|我们)(?:可以|也可以|建议)(?:帮你|为你)?(?:改成|改为|换成|写成一个|提供一个)/,
  /(?:建议|不妨)(?:你)?(?:改|换|调)(?:一个|成|为)/,
  // 道歉开场
  /^(?:很|非常)?(?:抱歉|对不起|不好意思)[，,。!！\s]/,
  // English
  /\bI\s+(?:can\s*not|can't|cannot|won't|will\s+not|am\s+unable\s+to|'m\s+unable\s+to)\b/i,
  /\bI(?:'m|\s+am)\s+(?:sorry|afraid)\b/i,
  /\bI\s+(?:must|have\s+to)\s+(?:decline|refuse)\b/i,
  /\bas\s+an?\s+(?:AI|assistant|language\s+model)\b/i,
  /\bagainst\s+my\s+(?:policy|guidelines|programming)\b/i,
  /\bI\s+(?:can|will)\s+help\s+you\s+with\s+something\s+else\b/i,
]

/**
 * Structure a rewritten prompt almost always carries: a heading, a bullet, a
 * numbered step, a labelled field, or an explicit role assignment. Its presence
 * is evidence that the model did the job and merely quoted a refusal-adjacent
 * word, so it suppresses the verdict.
 */
const SCAFFOLD_PATTERNS: readonly RegExp[] = [
  /(?:^|\n)\s*#{1,6}\s/, // markdown heading
  /(?:^|\n)\s*[-*+•]\s+/, // bullet
  /(?:^|\n)\s*\d+[.)、]\s*/, // numbered step
  /(?:^|\n)\s*(?:角色|身份|目标|任务|步骤|要求|约束|输出格式|验收|背景|Role|Goal|Task|Steps?|Requirements?|Constraints?|Output format|Context)\s*[:：]/i,
  /\bYou are\b/i, // role assignment inside the prompt body
  /你是(?:一名|一个|一位|资深的|专业的)/,
  /<raw_prompt>/,
]

/**
 * Whether one reply is a refusal (or a lecture about the request) instead of a
 * rewrite.
 * @param text - the model's reply, normalized.
 * @returns `true` when the head of the reply declines and nothing in it looks
 *   like the structure of a written prompt.
 */
export function isRefusalReply(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  const head = trimmed.length > REFUSAL_SCAN_CHARS ? trimmed.slice(0, REFUSAL_SCAN_CHARS) : trimmed
  if (!DECLINE_PATTERNS.some((pattern) => pattern.test(head))) return false
  // A refusal is short and unstructured; a rewrite of a paragraph is neither.
  return !SCAFFOLD_PATTERNS.some((pattern) => pattern.test(trimmed))
}
