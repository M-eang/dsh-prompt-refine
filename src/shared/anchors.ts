/**
 * Deterministic fidelity gate: pull the literal facts out of a draft and check
 * that a rewrite still carries them.
 *
 * The strategy prompt asks the model to keep paths, identifiers, versions and
 * URLs verbatim, but a prompt is a request, not a guarantee — and an LLM asked
 * to "make this clearer" will happily drop `--max-output-tokens`, rewrite
 * `0.2.8` as "the current version", or translate a package name. Everything in
 * this module is mechanical: the same draft always yields the same anchor set,
 * and the same output always yields the same verdict. No model, no locale, no
 * configuration decides what a draft's hard facts are.
 *
 * Two rules shape the extraction:
 *
 * - **Fenced blocks are claimed but not recorded.** A draft that carries a
 *   sample payload inside ``` may legitimately reshape it (it is illustrative
 *   content, not a fact about the task), while the identifiers inside the
 *   prose are facts. Fenced regions therefore protect their contents from
 *   being separately claimed — an inline `x` inside a fence is not a second
 *   anchor — without becoming anchors themselves.
 * - **First match wins.** Matchers run in precedence order and claim their
 *   span, so a URL that contains a path, or a version inside an inline code
 *   span, is recorded once under its most specific kind instead of twice.
 *
 * @module dsh-prompt-refine/shared/anchors
 */

/** The kind of literal fact an anchor holds; display and diagnostics only. */
export type AnchorKind = 'url' | 'path' | 'file' | 'version' | 'number' | 'code' | 'quote' | 'identifier'

/** One literal fragment a rewrite is expected to carry verbatim. */
export interface Anchor {
  /** The literal text, as it appeared in the draft. */
  text: string
  /** Which matcher claimed it. */
  kind: AnchorKind
}

/** Verdict of one fidelity check. */
export interface FidelityVerdict {
  /** Anchors found in the draft. */
  total: number
  /** How many of them the rewrite still carries. */
  kept: number
  /** The ones it does not carry, in draft order. */
  missing: Anchor[]
}

/** A claimed `[start, end)` span; used to resolve matcher overlaps. */
interface Span {
  start: number
  end: number
}

/** Hard ceilings: a huge draft must not turn into an unbounded prompt or log. */
const MAX_ANCHORS = 200
/** Fragments shorter than this are noise ("v1", "a-1"); they are not anchors. */
const MIN_LENGTH = 2
/** A single anchor is truncated to this many code points before recording. */
const MAX_ANCHOR_CHARS = 120

/**
 * Length gate constants. A rewrite that more than triples a draft that is
 * already substantial is bloating it; the floor keeps a legitimately terse
 * draft ("fix the bug") from tripping the gate, because growing 12 characters
 * into a structured prompt is the whole point of the plugin.
 */
export const MAX_LENGTH_RATIO = 3
export const MIN_BUDGET_CHARS = 200

/** One extraction matcher: a pattern plus how its capture is read out. */
interface Matcher {
  kind: AnchorKind
  pattern: RegExp
  /** Which capture group holds the literal (0 = the whole match). */
  group?: number
  /** Extra predicate for patterns whose shape alone is too permissive. */
  accept?: (text: string) => boolean
}

/**
 * Matchers in precedence order. An earlier matcher claims its span, so the
 * later, more permissive ones only see what is left.
 */
const MATCHERS: readonly Matcher[] = [
  // Inline code: the draft author marked this as literal, so record the
  // content without the backticks (a rewrite may legitimately change the
  // quoting style while keeping the fact).
  { kind: 'code', pattern: /`([^`\n]{2,120})`/g, group: 1 },
  { kind: 'url', pattern: /https?:\/\/[^\s<>"'`)\]}，。；]+/g },
  // Windows drive paths (D:\a\b) and multi-segment POSIX paths (/usr/local/x).
  { kind: 'path', pattern: /[A-Za-z]:[\\/][^\s<>"'`|?*，。；]+/g },
  { kind: 'path', pattern: /(?:\/[\w@.+-]+){2,}\/?/g },
  // Relative, multi-segment paths (src/config.ts, docs/history/a.md): the
  // leading segment is what makes it a path rather than a bare file name, and
  // matching it here keeps the directory out of the "dropped" report when a
  // rewrite keeps only the file name.
  { kind: 'path', pattern: /(?:\.{0,2}\/)?(?:[\w@.+-]+\/)+[\w@.+-]+/g },
  // Bare file names are facts too (`config.ts`, `cordis.patch.yml`); the
  // extension list keeps prose like "e.g." or "1.2.3" out.
  {
    kind: 'file',
    pattern: /\b[\w@.-]+\.(?:ts|tsx|jsx?|mjs|cjs|json|jsonc|mdx?|ya?ml|toml|ini|py|rb|go|rs|java|kt|cs|cpp|cc|h|css|scss|html|xml|sql|sh|bash|ps1|bat|cmd|exe|dll|log|txt|csv|tsv|zip|tar|gz|png|jpe?g|svg|pdf|onnx|gguf|safetensors|bin|zst|lock)\b/gi,
  },
  // Versions and release-ish identifiers: v1.5.2, 0.2.8, 3.18.0-rc.2.
  { kind: 'version', pattern: /\bv?\d+\.\d+(?:\.\d+)*(?:-[\w.]+)?\b/g },
  // Numbers that carry a unit or are long enough to be a real value (port,
  // timeout, byte count); a bare "2" in prose is not worth an anchor.
  { kind: 'number', pattern: /\b\d+(?:\.\d+)?\s?(?:%|ms|s|sec|seconds|m|min|minutes|h|hours|kb|mb|gb|tb|k|m|b|x|倍|分钟|小时|行|条|个)\b/gi },
  { kind: 'number', pattern: /\b\d{3,}\b/g },
  // Quoted terms: the draft author is naming something exactly.
  { kind: 'quote', pattern: /[「『“"]([^「」『』“”"\n]{2,60})[」』”"]/g, group: 1 },
  // Scoped npm names / GitHub slugs.
  { kind: 'identifier', pattern: /@[\w.-]+\/[\w.-]+/g },
  // Identifiers that are visibly code-shaped: snake_case, camelCase, CONSTANT,
  // digit-bearing, or long hyphenated slugs. Plain lowercase words fall through
  // so ordinary prose does not become a pile of "missing" anchors.
  {
    kind: 'identifier',
    pattern: /\b[A-Za-z][\w-]{1,60}\b/g,
    accept: (text: string): boolean =>
      (text.includes('_') || /[a-z][A-Z]/.test(text) || /^[A-Z][A-Z0-9_]{2,}$/.test(text) || /\d/.test(text) || (text.includes('-') && text.length >= 5)),
  },
]

/** Fenced regions are claimed (never anchored): ``` or ~~~ blocks. */
const FENCE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|$)/gm

/** True when two spans overlap at all. */
function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end
}

/** Code-point length (an emoji is one character, as the user sees it). */
export function codePointLength(text: string): number {
  let count = 0
  for (const _char of text) count += 1
  return count
}

/**
 * Extract the draft's literal facts.
 *
 * @param draft - the user's raw draft (unframed, as typed).
 * @returns anchors in draft order, de-duplicated by text, capped at
 *   {@link MAX_ANCHORS}; empty for an empty draft.
 */
export function extractAnchors(draft: string): Anchor[] {
  if (draft === '') return []
  const claimed: Span[] = []
  for (const match of draft.matchAll(FENCE)) {
    if (match.index === undefined) continue
    claimed.push({ start: match.index, end: match.index + match[0].length })
  }
  const anchors: Anchor[] = []
  const seen = new Set<string>()
  for (const matcher of MATCHERS) {
    if (anchors.length >= MAX_ANCHORS) break
    // A global regex carries `lastIndex` between `matchAll` calls only when it
    // is shared; each `matchAll` here restarts from the pattern's own state, so
    // the pattern is used as a literal and never stored mutated.
    for (const match of draft.matchAll(matcher.pattern)) {
      if (anchors.length >= MAX_ANCHORS) break
      if (match.index === undefined) continue
      const raw = matcher.group !== undefined ? match[matcher.group] : match[0]
      if (raw === undefined) continue
      // A capture-group matcher reports the group's own offset inside the
      // match, not the match's; approximate it by locating the literal.
      const start = matcher.group !== undefined ? match.index + match[0].indexOf(raw) : match.index
      const span: Span = { start, end: start + raw.length }
      if (claimed.some((existing) => overlaps(existing, span))) continue
      const text = raw.slice(0, MAX_ANCHOR_CHARS)
      if (codePointLength(text) < MIN_LENGTH) continue
      if (matcher.accept !== undefined && !matcher.accept(text)) {
        // A rejected candidate must not claim its span either: the literal may
        // still be matched by a later, more specific matcher.
        continue
      }
      claimed.push(span)
      if (seen.has(text)) continue
      seen.add(text)
      anchors.push({ text, kind: matcher.kind })
    }
  }
  return anchors
}

/**
 * Compare a rewrite against a draft's anchors under three relaxation tiers.
 *
 * A rewrite legitimately reflows whitespace, and a model that keeps a path
 * intact but re-wraps the line around it has not lost the fact. The tiers are
 * tried in order — exact, whitespace-collapsed, whitespace-stripped — and any
 * tier matching counts as kept. When a tier is ambiguous the verdict leans
 * toward "still there": a false negative would spend a repair call (or append
 * a redundant block) on a rewrite that was already faithful.
 *
 * @param anchors - output of {@link extractAnchors} for the same draft.
 * @param output - the normalized rewrite.
 * @returns how many anchors survived and which did not.
 */
export function verifyAnchors(anchors: readonly Anchor[], output: string): FidelityVerdict {
  const collapsed = output.replace(/\s+/g, ' ')
  const stripped = output.replace(/\s+/g, '')
  const missing: Anchor[] = []
  let kept = 0
  for (const anchor of anchors) {
    const tiers = [output, collapsed, stripped]
    const alive = tiers.some((tier) => {
      return tier.includes(anchor.text)
    }) || tiers.some((tier) => {
      // A literal whose own internal whitespace the model reflowed: compare
      // with whitespace removed on both sides.
      return tier.includes(anchor.text.replace(/\s+/g, ''))
    })
    if (alive) kept += 1
    else missing.push(anchor)
  }
  return { total: anchors.length, kept, missing }
}

/** Heading of the deterministic re-injection block (kept stable for tests). */
export const REINJECTION_HEADING = '原始细节（未被改写，照抄自原草稿）：'

/** Heading of the one repair pass's instruction clause (stable for tests). */
export const REPAIR_CLAUSE_HEADING = '上一版改写丢失了下列原始细节'

/**
 * Build the one repair pass's instruction clause.
 *
 * It names the missing literals verbatim and asks for a complete rewrite —
 * not a patch — because the caller replaces its text with the reply.
 *
 * @param missing - anchors the previous rewrite dropped.
 * @returns the clause to append to the framed user prompt.
 */
export function buildRepairClause(missing: readonly Anchor[]): string {
  const lines = missing.map((anchor) => `- ${anchor.text}`)
  return [
    '',
    `${REPAIR_CLAUSE_HEADING}。请重新输出完整的改写结果（不要输出补丁或说明），并在新版本中逐字保留以下内容：`,
    ...lines,
    '除补全以上内容外，其余部分与上一版保持一致：不要新增事实、不要改变任务范围。',
  ].join('\n')
}

/**
 * Build the deterministic appendix that carries literals the model still
 * dropped after its repair attempt.
 *
 * Re-pasting is deliberately last: fidelity outranks tidiness, and a prompt
 * that carries an exact path in a labeled appendix is strictly more useful
 * than one that silently lost it. The caller reports the block in the panel so
 * the user knows the model did not weave it into the prose.
 *
 * @param missing - anchors still absent from the final rewrite.
 * @returns the text to append, or the empty string when nothing is missing.
 */
export function buildReinjectionBlock(missing: readonly Anchor[]): string {
  if (missing.length === 0) return ''
  const lines = missing.map((anchor) => `- ${anchor.text}`)
  return ['', REINJECTION_HEADING, ...lines].join('\n')
}

/**
 * Length-gate verdict for one rewrite.
 *
 * @param draft - the raw draft.
 * @param output - the normalized rewrite.
 * @returns the code-point ratio (0 when the draft is empty) and whether the
 *   rewrite counts as bloated (above {@link MAX_LENGTH_RATIO} and above
 *   {@link MIN_BUDGET_CHARS}).
 */
export function lengthVerdict(draft: string, output: string): { ratio: number; bloated: boolean } {
  const inputChars = codePointLength(draft)
  const outputChars = codePointLength(output)
  if (inputChars === 0) return { ratio: 0, bloated: false }
  const ratio = outputChars / inputChars
  return { ratio, bloated: ratio > MAX_LENGTH_RATIO && outputChars > MIN_BUDGET_CHARS }
}
