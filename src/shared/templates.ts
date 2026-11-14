/**
 * Built-in prompt templates (「模板库」): named framings that turn a generic
 * rewrite into one specific deliverable shape.
 *
 * A template is a *discipline addon*, exactly like an enhancement mode
 * (`shared/modes.ts`): its text rides at the very end of the system prompt and
 * can only add requirements. The built-in strategy's hard rules — never
 * invent, output the body only, keep the language and the intent — stay in
 * force no matter which template is selected. The two addons compose in a
 * fixed order, **mode first, template second**, and that order is locked by
 * tests because it decides which instruction wins when they disagree.
 *
 * Templates are deliberately few and closed: a template that only rewords the
 * request would be noise in the settings page, and an open-ended "custom
 * template" would duplicate `systemPrompt`. Each one here names a shape the
 * model would otherwise have to be told about every single time.
 *
 * The ids are the wire/settings vocabulary: they are stored in the plugin
 * config, rendered by the settings page (localized through
 * `settings.template.<id>`), and accepted as an optional first word by the
 * `/enhance` command. Renaming one is a breaking change to stored config.
 * @module dsh-prompt-refine/shared/templates
 */

/** Every built-in template id, in selector order. */
export const ENHANCE_TEMPLATES = [
  'code-review',
  'bug-report',
  'weekly-report',
  'api-doc',
  'test-plan',
  'refactor',
] as const

/** One built-in template id. */
export type EnhanceTemplateId = (typeof ENHANCE_TEMPLATES)[number]

/** What a template contributes to the system prompt. */
export interface TemplateSpec {
  /** Appended after the mode addon; empty would make the template a no-op. */
  readonly systemAddon: string
}

/**
 * The addon of each template. Every line is an instruction to the *model*
 * about the shape of the deliverable, mirroring the voice of `MODE_SPECS`, and
 * every one of them ends on the fidelity rule the gate enforces mechanically:
 * the literals the draft names must survive, and nothing may be invented to
 * fill a heading out.
 */
export const TEMPLATE_SPECS: Record<EnhanceTemplateId, TemplateSpec> = {
  'code-review': {
    systemAddon:
      'Template — code review. Frame the rewritten request as asking for a review of the named change: say what is being changed and where, what the reviewer should focus on (correctness, boundary cases, maintainability), and the required output shape — findings listed one per item, each supported by the evidence that backs it. Never invent a finding, a file or a line the draft does not mention, and never widen the scope of the change.',
  },
  'bug-report': {
    systemAddon:
      'Template — bug report. Frame the rewritten request as a report someone else has to reproduce: the symptom, the exact reproduction steps, the expected result, the actual result, the environment or version it happens in, and which evidence (logs, screenshots, config) should be attached. Keep every literal the draft names — never invent a stack trace, a version or a file.',
  },
  'weekly-report': {
    systemAddon:
      'Template — weekly report. Frame the rewritten request as a progress summary: the reporting period, the workstreams, what was completed, what slipped, the blockers, and the next steps. Keep it factual and terse; no filler praise and no invented metrics or numbers.',
  },
  'api-doc': {
    systemAddon:
      'Template — API documentation. Frame the rewritten request as reference documentation for the named endpoint, function or field: its signature, its parameters with types and defaults, its return value, its error conditions, and one usage example. Never invent a parameter, a field or an error the draft does not mention.',
  },
  'test-plan': {
    systemAddon:
      'Template — test plan. Frame the rewritten request as a verification plan: the scope, the cases (each with its input and its expected result), the boundary and failure cases, and how the outcome is verified. Never invent a case, an input or an expected result the draft does not mention; prefer concrete cases over prose about testing.',
  },
  refactor: {
    systemAddon:
      'Template — refactor task. Frame the rewritten request as a refactoring brief: the current structure, the target structure, the constraints (behaviour and public interfaces stay unchanged unless the draft says otherwise), and how correctness is verified afterwards. Name the files and symbols the draft names, invent none, and add none.',
  },
}

/** Whether `value` is one of the built-in template ids. */
export function isEnhanceTemplate(value: unknown): value is EnhanceTemplateId {
  return typeof value === 'string' && (ENHANCE_TEMPLATES as readonly string[]).includes(value)
}

/**
 * The system-prompt addon of `id`, or `''` for "no template" — `undefined`,
 * `null`, `''` and any unknown/hand-edited string are all the same no-op, so a
 * bad stored value degrades to the historical byte-identical prompt instead of
 * throwing at the call boundary.
 */
export function templateSystemAddon(id: string | undefined | null): string {
  return isEnhanceTemplate(id) ? TEMPLATE_SPECS[id].systemAddon : ''
}

/**
 * Resolve the effective template: a valid per-call override wins over the
 * configured default, and anything invalid on either side means "no template".
 * The per-call side is the `/enhance <template> <text>` form; the configured
 * side is the settings field.
 * @param configValue - the configured template (possibly `''` or junk).
 * @param override - an explicit per-call template, when the caller passed one.
 * @returns the template to apply, or `undefined` for none.
 */
export function resolveTemplateId(configValue: string | undefined, override?: string | undefined): EnhanceTemplateId | undefined {
  if (isEnhanceTemplate(override)) return override
  if (isEnhanceTemplate(configValue)) return configValue
  return undefined
}
