/**
 * 引用保护：草稿里的 `@文件` 与 `/技能` 不是正文词，而是宿主输入框的引用 chip。
 *
 * 宿主把 chip 存成纯文本（`@src/app.ts`、`@"my file.md"`、`/code-review`），提交时
 * codec 原样序列化给模型。所以一次「改写」足以把它们改坏：模型会把
 * `@src/app.ts` 译成「那个文件」、把 `/code-review` 改写成「代码审查」、给
 * `@"my file.md"` 补个句号——chip 随即失效，用户还得手动重插。
 *
 * 这里的做法是确定性的：改写前把每个引用换成占位符 `⟦n⟧`，模型看不到真实
 * 文本，也就不可能改坏它；改写后按编号逐字还原。不调模型、不猜、同一份草稿
 * 永远得到同一组占位符。
 *
 * 三条边界规则（都是为了避免误伤普通文本）：
 * - `@` 只在「前一个字符不像邮箱/路径中段」时才算引用起点，`a@b.com` 不动。
 * - `/` 只在「前一个字符不是字母数字、`:`、`/`、`.`、`@`」时才算起点，
 *   `https://x/y` 与 `and/or` 不动；名字后面必须紧跟边界，`/home/user/a.txt`
 *   不动。
 * - 尾部标点归正文，不属于引用：`看 @app.ts，然后` 里的逗号留给句子。
 * @module dsh-prompt-refine/shared/refs
 */

/** 引用种类：`@`（文件/目录/会话）与 `/`（命令/技能）。 */
export type RefKind = 'at' | 'slash'

/** 一条被保护的引用。 */
export interface DraftRef {
  /** 哪一种触发符。 */
  kind: RefKind
  /** 原样文本（含触发符），还原时逐字写回。 */
  text: string
}

/** 一次保护的结果。 */
export interface RefProtection {
  /** 交给模型的正文：引用已换成占位符。 */
  body: string
  /** 按出现顺序记录的引用，编号即下标 + 1。 */
  refs: DraftRef[]
}

/** 一次还原的结果。 */
export interface RefRestore {
  /** 还原后的正文。 */
  text: string
  /** 模型吞掉（或其改写的形态认不出）的引用，已追加在末尾。 */
  missing: DraftRef[]
}

/** `@` 前面允许出现「引用起点」的字符：不像邮箱、不像路径中段。 */
const AT_EXCLUDED_PREV = /[A-Za-z0-9_.+@/\\-]/

/** `/` 前面允许出现「引用起点」的字符：不像 URL、不像路径、不像词中段。 */
const SLASH_EXCLUDED_PREV = /[A-Za-z0-9_.+:\\\\/@-]/

/** `/name` 的形态：触发符 + 一个字开头的名字（技能名可能是中文）。 */
const SLASH_NAME = /^\/[\p{L}][\p{L}\p{N}_-]*/u

/** 引用尾部不属于引用的标点。 */
const TAIL_PUNCT = new Set([...',.;:!?，。、；：！？）)]}】》>”’'])

/** 空白：引用的硬边界。 */
const SPACE = /\s/

/**
 * 扫描引用时的终止符：中文句读与成对符号。**不含** `.`、`:`、`/`、`-`、`_`
 * 与半角逗号——路径里到处都是它们（`C:/a/b.md`、`v1.2/app-min.js`）。
 */
const HARD_STOP = new Set([...'，。、；：！？（）「」『』《》〈〉【】<>“”‘’;!?()'])

/** 路径字符集：含斜杠的引用只吃这些字符，其余留给句子。 */
const PATH_CHAR = /[A-Za-z0-9_.\-/\\~]/

/**
 * 判断某个 `@` 是否是引用起点。
 * @param text - 全文。
 * @param index - `@` 的下标。
 * @returns 是则 true。
 */
function atStart(text: string, index: number): boolean {
  if (index === 0) return true
  return !AT_EXCLUDED_PREV.test(text.charAt(index - 1))
}

/**
 * 判断某个 `/` 是否是引用起点。
 * @param text - 全文。
 * @param index - `/` 的下标。
 * @returns 是则 true。
 */
function slashStart(text: string, index: number): boolean {
  if (index === 0) return true
  return !SLASH_EXCLUDED_PREV.test(text.charAt(index - 1))
}

/**
 * 从 `@` 起扫一条引用。
 * @param text - 全文。
 * @param index - `@` 的下标。
 * @returns 结束下标（不含），或 `-1` 表示这里不是引用。
 */
function scanAt(text: string, index: number): number {
  let cursor = index + 1
  if (cursor >= text.length) return -1
  if (text.charAt(cursor) === '"') {
    // `@"带空格的路径"`：引号形态是宿主对含空格路径的唯一可表示写法。
    cursor++
    while (cursor < text.length && text.charAt(cursor) !== '"') cursor++
    return cursor < text.length ? cursor + 1 : -1
  }
  while (cursor < text.length && !SPACE.test(text.charAt(cursor)) && !HARD_STOP.has(text.charAt(cursor))) {
    // 下一个 `@` 是新引用的起点，不并进本条。
    if (text.charAt(cursor) === '@' && atStart(text, cursor)) break
    cursor++
  }
  // 含斜杠的候选是一条路径，路径字符集之外的东西属于句子：`看@src/app.ts哪里慢`
  // 里「哪里慢」是正文，不是文件名的一部分。
  const candidate = text.slice(index, cursor)
  if (/[/\\]/.test(candidate)) {
    while (cursor > index + 1 && !PATH_CHAR.test(text.charAt(cursor - 1))) cursor--
  }
  while (cursor > index + 1 && TAIL_PUNCT.has(text.charAt(cursor - 1))) cursor--
  return cursor > index + 1 ? cursor : -1
}

/**
 * 从 `/` 起扫一条命令/技能引用。
 * @param text - 全文。
 * @param index - `/` 的下标。
 * @returns 结束下标（不含），或 `-1` 表示这里不是引用。
 */
function scanSlash(text: string, index: number): number {
  const match = SLASH_NAME.exec(text.slice(index, index + 64))
  if (match === null) return -1
  const end = index + match[0].length
  const next = text[end]
  // `/home/user/a.txt` 这类路径：名字后面还跟着 `/` 或词字符，不当作引用。
  if (next !== undefined && !SPACE.test(next) && !TAIL_PUNCT.has(next)) return -1
  return end
}

/**
 * 把草稿里的引用换成占位符。
 * @param text - 去掉首行命令后的正文。
 * @returns 占位符正文与引用清单。
 */
export function protectRefs(text: string): RefProtection {
  const refs: DraftRef[] = []
  let body = ''
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === '@' && atStart(text, index)) {
      const end = scanAt(text, index)
      if (end !== -1) {
        refs.push({ kind: 'at', text: text.slice(index, end) })
        body += `⟦${refs.length}⟧`
        index = end
        continue
      }
    }
    if (char === '/' && slashStart(text, index)) {
      const end = scanSlash(text, index)
      if (end !== -1) {
        refs.push({ kind: 'slash', text: text.slice(index, end) })
        body += `⟦${refs.length}⟧`
        index = end
        continue
      }
    }
    body += char
    index++
  }
  return { body, refs }
}

/**
 * 一条占位符的识别式。模型偶尔会把 `⟦1⟧` 写成 `【1】`、`〔1〕`，或包进反引号，
 * 这里一并认；`[1]` 不认——Markdown 的链接与脚注里到处都是它。
 * @param n - 编号。
 * @returns 只认这一个编号的正则（不带 `g`，replace 只动第一处）。
 */
function exactToken(n: number): RegExp {
  return new RegExp('`?(?:⟦|【|〔|〖)\\s*' + String(n) + '\\s*(?:⟧|】|〕|〗)`?', 'u')
}

/** 任意编号的占位符，用于兜底清扫。 */
const ANY_TOKEN = /`?(?:⟦|【|〔|〖)\s*(\d+)\s*(?:⟧|】|〕|〗)`?/gu

/**
 * 把占位符还原成引用原文。认不出的引用追加在末尾，绝不静默丢弃。
 * @param body - 模型给出的改写结果。
 * @param refs - {@link protectRefs} 记录的引用。
 * @returns 还原后的正文与丢失的引用。
 */
export function restoreRefs(body: string, refs: readonly DraftRef[]): RefRestore {
  let text = body
  const placed = new Set<DraftRef>()
  refs.forEach((ref, position) => {
    const pattern = exactToken(position + 1)
    if (!pattern.test(text)) return
    // 函数式替换：引用原文里可能有 `$&` 之类，不能当替换模式解释。
    text = text.replace(pattern, () => ref.text)
    placed.add(ref)
  })
  // 兜底清扫：模型复制了编号、或把编号挪到了别处时，残留的占位符不能让用户
  // 看到。编号认不出就删掉；编号认得但这一条已经还原过，就把它让给还没还原
  // 的同文本引用（重复出现的引用正是这种情况），否则就地补一份原文。
  text = text.replace(ANY_TOKEN, (whole) => {
    const digits = /\d+/.exec(whole)
    const index = digits === null ? 0 : Number(digits[0])
    const ref = refs[index - 1]
    if (ref === undefined) return ''
    if (!placed.has(ref)) {
      placed.add(ref)
      return ref.text
    }
    const twin = refs.find((other) => !placed.has(other) && other.text === ref.text)
    if (twin !== undefined) {
      placed.add(twin)
      return twin.text
    }
    return ref.text
  })
  // 一条占位符都没出现（或编号被彻底改掉）的引用追加在末尾：位置不理想，
  // 但引用不会消失。
  const missing = refs.filter((ref) => !placed.has(ref))
  if (missing.length > 0) {
    const tail = missing.map((ref) => ref.text).join(' ')
    text = `${text.trimEnd()}\n\n${tail}`
  }
  return { text, missing }
}

/**
 * 只做替换、不做还原的判定：草稿里有没有需要保护的引用。
 * @param text - 草稿正文。
 * @returns 是否存在引用。
 */
export function hasRefs(text: string): boolean {
  return protectRefs(text).refs.length > 0
}
