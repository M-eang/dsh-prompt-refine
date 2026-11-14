/**
 * Enhancement modes（档位）：同一套硬性约束下的七种输出形态。
 *
 * 生态里的同类插件（Fishsb__dsh-prompt-refiner 的 base/lite/standard/smart/publish、
 * hoyyang__dsh-improve-prompt 的档位）把"力度"做成覆盖面差异；本插件只取其中
 * 真正改变**输出形态**的那几类，加上保持现状的默认档：
 *
 * - `standard`（默认）：完全等于历史行为 —— 不加任何模式纪律、不设我们自己的
 *   输出上限。改这一档的默认值等于偷偷改所有老用户的输出，所以它什么都不做。
 * - `concise`：只清晰化、不许膨胀，并给一个真实的输出预算。
 * - `spec`：产出可交付的规格（分节 + 可验收条目），预算更高。
 * - `engineering`：工程提示词/施工单 —— 目标、约束、接口、步骤、验收各就各位，
 *   实现方拿到就能动手，不必回头再问。
 * - `colloquial`：口语优化 —— 把口述、速记、术语堆砌整理成自然好读的普通话，
 *   保持散文形态，不擅自把一句话升级成规格书。
 * - `research`：调研论证 —— 把问题摆成能被反驳的形状：已知、假设、备选、
 *   判据、要落地的决定。
 * - `creative`：创意发散 —— 给出意图、受众、基调与硬约束，让候选在思路上分岔，
 *   而不是在措辞上换皮。
 *
 * 模式纪律追加在系统提示词的**最后**（比内置策略与自定义文本更具体），但不会
 * 覆盖内置的硬性约束：不编造、只输出正文、保持语言这些规则永远在。
 * @module dsh-prompt-refine/shared/modes
 */

/** Every enhancement mode. */
export type EnhanceMode = 'colloquial' | 'concise' | 'creative' | 'engineering' | 'research' | 'spec' | 'standard'

/** Every mode id, in the order the settings page renders them. */
export const ENHANCE_MODES: readonly EnhanceMode[] = [
  'standard',
  'concise',
  'spec',
  'engineering',
  'colloquial',
  'research',
  'creative',
]

/** One mode's discipline and its own output budget. */
export interface ModeSpec {
  /** Appended to the system prompt (empty for the default mode). */
  readonly systemAddon: string
  /**
   * Output token budget this mode asks for when the operator has not set an
   * explicit `maxOutputTokens`. `0` = send no cap of our own.
   */
  readonly maxOutputTokens: number
}

/** Mode definitions. `standard` is the identity mode on purpose. */
export const MODE_SPECS: Record<EnhanceMode, ModeSpec> = {
  standard: {
    systemAddon: '',
    maxOutputTokens: 0,
  },
  concise: {
    systemAddon: [
      '',
      'Mode: concise. The operator asked for the smallest useful rewrite.',
      '- Keep the rewrite tight: keep every fact, cut padding, and do not add sections the raw prompt does not need.',
      '- Aim for at most about 1.5x the raw prompt length; a one-paragraph prompt stays one paragraph.',
      '- Merging two related items into one clear sentence is fine; dropping an item is not.',
    ].join('\n'),
    maxOutputTokens: 2000,
  },
  spec: {
    systemAddon: [
      '',
      'Mode: spec. The operator wants a deliverable specification, not a plain rewrite.',
      '- Structure the rewrite with explicit section headings covering: goal, inputs, constraints, deliverable format, acceptance criteria, and boundary cases. Skip a section only when the raw prompt genuinely has nothing to say about it — never invent its content.',
      '- Prefer numbered, testable statements over prose.',
      '- Keep every literal from the raw prompt in place; mark an unknown detail with a short placeholder instead of filling it in.',
    ].join('\n'),
    maxOutputTokens: 8000,
  },
  engineering: {
    systemAddon: [
      '',
      'Mode: engineering. The operator wants a work order someone else can execute without asking a follow-up question.',
      '- Structure it as: objective, current context, hard constraints, the interfaces/files/symbols it touches, the work split into ordered steps, and the acceptance check that proves each step.',
      '- Write each constraint so it can be tested; name the states that must not happen as explicitly as the ones that must.',
      '- Keep every literal the raw prompt names — paths, signatures, versions, commands — and mark an unknown one with a placeholder instead of inventing a value.',
      '- No motivational framing and no padding: a step nobody can verify does not belong in the plan.',
    ].join('\n'),
    maxOutputTokens: 8000,
  },
  colloquial: {
    systemAddon: [
      '',
      'Mode: colloquial. The operator dictated this out loud or typed it in a hurry; the rewrite has to read like a person speaking clearly, not like a document.',
      '- Keep running prose: no headings, no numbered steps, no bullet scaffolding the raw prompt did not already have.',
      '- Short sentences, everyday verbs, and the raw prompt\'s own voice kept (a first-person request stays first person). Replace stiff nominalizations with the plain verb.',
      '- Change wording, never content: add no fact, no example, no requirement, and do not promote a sentence into a specification.',
      '- Keep the original politeness and the original amount of detail. The goal is fluency, not length.',
    ].join('\n'),
    maxOutputTokens: 2000,
  },
  research: {
    systemAddon: [
      '',
      'Mode: research. The operator wants the question posed so an answer can be argued with, not a task list.',
      '- Structure it as: the question, what is already known or assumed, the alternatives or hypotheses worth comparing, the evidence that would separate them, and the decision those findings drive.',
      '- Keep fact and assumption visibly apart; never promote one to the other.',
      '- Ask for the answer\'s shape (comparison, recommendation with reasons, risks, open questions) only as far as the raw prompt implies it.',
      '- Every source, version and number the raw prompt names must survive; invent none, and do not widen the scope beyond the question asked.',
    ].join('\n'),
    maxOutputTokens: 6000,
  },
  creative: {
    systemAddon: [
      '',
      'Mode: creative. The operator wants room to explore, and the rewrite must open that room without losing the constraints that make the output usable.',
      '- Structure it as: the intent, the audience, the tone and register, the hard constraints, the references worth following, and how many distinct options are wanted.',
      '- Keep the constraints explicit and few; they are what makes divergence useful instead of random.',
      '- State what must not be produced (clichés, disclaimers, moralising, filler openings) when the raw prompt implies a taste boundary.',
      '- Never invent a reference, a brand or a fact; ask for the options to differ in approach, not in wording.',
    ].join('\n'),
    maxOutputTokens: 4000,
  },
}

/** True when `value` is one of the known modes (defensive: configs are user-editable). */
export function isEnhanceMode(value: unknown): value is EnhanceMode {
  return typeof value === 'string' && (ENHANCE_MODES as readonly string[]).includes(value)
}

/**
 * The system-prompt addon of one mode. An unknown/absent mode reads as
 * `standard`, so an older stored config keeps byte-identical instructions.
 * @param mode - the resolved mode (possibly an out-of-range stored value).
 * @returns the addon text, or `''` for the identity mode.
 */
export function modeSystemAddon(mode: EnhanceMode | undefined): string {
  return isEnhanceMode(mode) ? MODE_SPECS[mode].systemAddon : ''
}

/**
 * The output budget of one call: an explicit positive `maxOutputTokens` always
 * wins over the mode's own number (the operator's setting is the more specific
 * statement), and `0` means "send no cap" rather than "send zero".
 * @param explicit - `config.maxOutputTokens` as resolved.
 * @param mode - the resolved mode.
 * @returns the token cap to put on the request (`0` = no cap).
 */
export function resolveMaxTokens(explicit: number, mode: EnhanceMode | undefined): number {
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return isEnhanceMode(mode) ? MODE_SPECS[mode].maxOutputTokens : 0
}
