/**
 * 斜杠命令拆分：草稿常常是「`/logs 200` + 一句人话」。
 *
 * 命令本身是给宿主的指令，改写它只会把它改坏（`/logs 200` 变成
 * `/logs 150 行` 之类）。所以增强只作用在命令**之后**的正文上，命令原样保留。
 * 确定性拆分，不猜、不调模型。
 *
 * 只认第一行开头的命令形态：`/` + 字母/数字/下划线/连字符（不含 `/`），
 * 后面跟可选的参数。因此 `/home/user/a.txt 帮我改` 不会被误判成命令
 * （`/home/user/a.txt` 里还有斜杠）。
 * @module dsh-prompt-refine/shared/slash
 */

/** 命令形态：`/name` 或 `/name args…`（整行）。 */
const COMMAND_LINE = /^\s*\/([a-z][a-z0-9_-]*)(?:[ \t]+(.*))?\s*$/i

/** 拆分结果。 */
export interface SlashSplit {
  /** 原样的命令行（含参数，已 trim）；没有命令时为 `''`。 */
  prefix: string
  /** 命令之后的正文（已 trim）；没有命令时等于整段原文。 */
  body: string
}

/**
 * 把草稿拆成「命令前缀 + 正文」。
 * @param text - 原始草稿。
 * @returns 前缀与正文；没有命令时 `prefix === ''`、`body === text.trim()`。
 */
export function splitSlashPrefix(text: string): SlashSplit {
  const newlineAt = text.indexOf('\n')
  const firstLine = (newlineAt === -1 ? text : text.slice(0, newlineAt)).trim()
  const rest = newlineAt === -1 ? '' : text.slice(newlineAt + 1).trim()
  if (!COMMAND_LINE.test(firstLine)) return { prefix: '', body: text.trim() }
  return { prefix: firstLine, body: rest }
}

/**
 * 把增强后的正文与命令前缀拼回草稿。前缀为空时就是正文本身。
 * @param prefix - `splitSlashPrefix` 给出的命令行。
 * @param body - 增强后的正文。
 * @returns 可直接回填输入框的文本。
 */
export function joinSlashPrefix(prefix: string, body: string): string {
  const clean = body.trim()
  if (prefix === '') return clean
  if (clean === '') return prefix
  return `${prefix}\n${clean}`
}
