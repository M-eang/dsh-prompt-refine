/**
 * Plugin configuration: one schemastery schema rendered automatically by
 * Settings → 插件配置, plus pure resolution/validation shared by the host
 * route, the slash command, and (mirrored defaults) the browser half.
 * @module dsh-prompt-refine/config
 */

import z from 'schemastery'
import { ENHANCE_MODES, isEnhanceMode, type EnhanceMode } from './shared/modes'
import { ENHANCE_TEMPLATES, isEnhanceTemplate, type EnhanceTemplateId } from './shared/templates'

/** Settings namespace of the plugin section. */
export const PROMPT_ENHANCE_NAMESPACE = 'prompt-enhance'

/** How a non-empty `systemPrompt` combines with the built-in strategy. */
export type StrategyMode = 'replace-default' | 'extend-default'

/** The plugin's deployed configuration. */
export interface Config {
  /** Master switch; off hides the composer button and disables all triggers. */
  enabled: boolean
  /** Explicit provider override; must be paired with `model`. */
  provider?: string
  /** Explicit model override; must be paired with `provider`. */
  model?: string
  /** Sampling temperature; low keeps the rewrite faithful to the original. */
  temperature: number
  /**
   * Output token cap of one enhancement call; `0` (the default) means
   * "no cap of our own" — the request carries no maximum, so the harness's
   * adapter default (or the provider's own) applies. A positive value is sent
   * verbatim. A gateway that injects thinking by default spends this budget on
   * reasoning too, so an explicit cap is a cap on `thinking + answer`, not on
   * the rewritten body alone.
   */
  maxOutputTokens: number
  /** Input character cap; over-length drafts are rejected, never truncated. */
  maxInputChars: number
  /** End-to-end deadline of one enhancement call. */
  timeoutMs: number
  /** System prompt; default is the built-in enhancement strategy. */
  systemPrompt: string
  /**
   * How a non-empty `systemPrompt` combines with the built-in strategy.
   * `replace-default` (the default, matching earlier versions) swaps the
   * built-in strategy out entirely — its hard rules are NOT retained and must
   * be carried into the custom text. `extend-default` appends the custom text
   * after the built-in strategy, keeping those rules in force.
   */
  strategyMode: StrategyMode
  /**
   * Enhancement mode（档位）：同一套硬性约束下的七种输出形态。`standard`
   * 等于历史行为（不加模式纪律、不设自己的输出上限），`concise` 只清晰化，
   * `spec` 产出可交付规格，`engineering` 写成施工单，`colloquial` 整理成
   * 自然口语，`research` 摆成可论证的调研问题，`creative` 打开发散空间。
   * 模式纪律追加在系统提示词最后，内置硬性约束不受影响。
   */
  mode: EnhanceMode
  /**
   * Built-in template（模板库）：把改写框定成一种具体交付形状（代码评审、
   * 缺陷报告、周报、API 文档、测试计划、重构简报）。空串 = 不用模板；
   * 模板纪律追加在档位纪律之后，硬性约束不受影响。`/enhance <模板> <文本>`
   * 可以在单次调用里覆盖它。
   */
  template: EnhanceTemplateId | ''
  /** Composer keyboard shortcut, e.g. "ctrl+alt+e"; empty disables it. */
  shortcut: string
  /** Max concurrently running enhancements (host-side resource cap). */
  maxConcurrent: number
  /** Sliding-window rate cap: enhancements per minute (host-side). */
  rateLimitPerMinute: number
  /**
   * Show the model's output in the panel as it streams instead of waiting for
   * the whole rewrite. Display-only: the final text is still the normalized
   * full result, so the output the user applies never changes.
   */
  streaming: boolean
  /**
   * Deterministic fidelity gate. The strategy prompt already asks the model to
   * keep the draft's literal facts — file paths, identifiers, versions, URLs —
   * intact; this verifies that mechanically after the call and re-pastes
   * verbatim whatever the rewrite dropped, under a label the user can see.
   * Costs no extra model call.
   */
  fidelity: boolean
  /**
   * Allow ONE repair pass when the gate finds dropped literals: a second call
   * names the missing facts and asks for a complete rewrite, whose text
   * replaces the first version. Bounded by construction — at most one extra
   * call per enhancement, and only when literals were actually lost — and a
   * failed, empty or cancelled repair keeps the first version.
   */
  fidelityRepair: boolean
  /**
   * Read the current conversation's recent history and use it to ground the
   * rewrite (resolve references, supply the established stack/constraints).
   * With no session, no history, or this switch off, the call degrades to the
   * original single-prompt enhancement.
   */
  contextAware: boolean
  /** Context window breadth: how many recent turns may ground the rewrite; 0 admits none. */
  contextMaxMessages: number
  /** Context window depth: character budget of the assembled history snippet; 0 admits none. */
  contextMaxChars: number
  /**
   * Read the session's working directory (directory structure + bounded file
   * excerpts) and use it to ground the rewrite. With no session, no working
   * directory, no `fs` service, or this switch off, the call degrades to the
   * conversation-only behaviour.
   */
  workspaceAware: boolean
  /**
   * Absolute directory to scan instead of the session's own working directory;
   * empty follows the session (`session.header.cwd`).
   */
  workspaceRoot: string
  /** Maximum directory nesting depth admitted by the scan. */
  workspaceMaxDepth: number
  /** Maximum entries listed in the directory-structure section. */
  workspaceTreeMax: number
  /** Maximum files whose excerpt is included. */
  workspaceMaxFiles: number
  /** Character cap of one file excerpt. */
  workspaceMaxFileChars: number
  /** Character cap of all file excerpts together. */
  workspaceMaxChars: number
  /**
   * Prompt armor: prepend an operator-controlled identity block above every
   * section the host assembles. Off by default — it overrides what the model
   * believes it is, so it is opt-in rather than a side effect of installing
   * the plugin. See `src/armor.ts`.
   */
  armorEnabled: boolean
  /**
   * File holding the armor body. The file wins over `armorText` when it exists
   * and is non-empty, so the block can be edited outside the settings page.
   * `~` and `${DSH_HOME}` expand. Empty (the default) means "no file": the
   * armour then comes from `armorText`, or from the built-in
   * `DEFAULT_ARMOR_PROMPT` when that is empty too.
   */
  armorFile: string
  /**
   * Inline armor body. Used when `armorFile` is unset, unreadable or empty;
   * empty (the default) falls through to the built-in `DEFAULT_ARMOR_PROMPT`,
   * so clearing both fields resets the armour instead of removing it.
   */
  armorText: string
  /** Section order the armor claims; lower sorts earlier. */
  armorOrder: number
  /**
   * Rewriter stance for the enhancement call itself: lead its system prompt
   * with "you are a rewriter, not a reviewer", and retry once when a reply
   * comes back as a refusal. Separate from `armorEnabled`, which governs the
   * host's chat prompt — this one governs the auxiliary rewrite call, and its
   * only job is that the rewrite happens at all. Default on: without it a
   * provider's declination is passed to the panel as if it were a result.
   */
  rewriterArmor: boolean
}

/** Field defaults, the source of truth for schema defaults and client mirrors. */
export const DEFAULT_CONFIG: Config = {
  enabled: true,
  temperature: 0.3,
  maxOutputTokens: 0,
  maxInputChars: 12000,
  timeoutMs: 60000,
  systemPrompt: '',
  strategyMode: 'replace-default',
  mode: 'standard',
  template: '',
  shortcut: 'ctrl+alt+e',
  maxConcurrent: 2,
  rateLimitPerMinute: 10,
  streaming: true,
  fidelity: true,
  fidelityRepair: true,
  contextAware: true,
  contextMaxMessages: 12,
  contextMaxChars: 8000,
  workspaceAware: true,
  workspaceRoot: '',
  workspaceMaxDepth: 2,
  workspaceTreeMax: 60,
  workspaceMaxFiles: 30,
  workspaceMaxFileChars: 2500,
  workspaceMaxChars: 12000,
  armorEnabled: false,
  armorFile: '',
  armorText: '',
  armorOrder: -100000,
  rewriterArmor: true,
}

/** The settings section schema (rendered by the built-in plugin config page). */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.enabled).description('总开关：关闭后隐藏输入框增强按钮并停用所有触发方式'),
  provider: z.string().description('覆盖模型路由的 provider（与「模型」必须成对填写；留空跟随当前会话模型）'),
  model: z.string().description('覆盖模型路由的 model（与「provider」必须成对填写；留空跟随当前会话模型）'),
  temperature: z.number().min(0).max(1).step(0.05).default(DEFAULT_CONFIG.temperature).description('采样温度；低温改写更忠实于原意'),
  maxOutputTokens: z.number().step(1).min(0).max(32768).default(DEFAULT_CONFIG.maxOutputTokens).description('单次增强的输出 token 上限；0（默认）= 不限，不向模型传上限，交由 harness/服务商默认值决定。填正数则严格按该上限（网关默认开启 thinking 时，思考内容也消耗该预算）'),
  maxInputChars: z.number().step(1).min(200).max(200000).default(DEFAULT_CONFIG.maxInputChars).description('输入字数上限；超限拒绝而不截断，避免改变原意'),
  timeoutMs: z.number().step(1).min(5000).max(600000).default(DEFAULT_CONFIG.timeoutMs).description('单次增强的超时（毫秒）'),
  systemPrompt: z.string().role('textarea').default(DEFAULT_CONFIG.systemPrompt).description('系统提示词；留空使用内置增强策略'),
  strategyMode: z.union(['replace-default', 'extend-default']).default(DEFAULT_CONFIG.strategyMode).description('自定义系统提示词的组合方式：整体替换内置策略（默认；内置策略的不编造、只输出正文等硬性约束不会自动保留），或把自定义文本追加在内置策略之后（硬性约束继续生效）'),
  mode: z.union([...ENHANCE_MODES]).default(DEFAULT_CONFIG.mode).description('增强档位（七种输出形态）：standard 标准（默认，等于历史行为，不加额外纪律、不设自己的输出上限）／concise 精简（只清晰化、不许膨胀，上限 2000 token）／spec 规格（分节、可验收的交付规格，上限 8000 token）／engineering 工程提示词（目标·约束·接口·步骤·验收，拿到即可施工，上限 8000 token）／colloquial 口语优化（口述与术语堆砌整理成自然口语，保持散文形态，上限 2000 token）／research 调研论证（已知·假设·备选·判据·决定，上限 6000 token）／creative 创意发散（意图·受众·基调·硬约束·候选，上限 4000 token）。档位纪律追加在系统提示词最后，不覆盖「不编造、只输出正文」等硬性约束；显式填写「输出 token 上限」时以该值为准；单次覆盖可用 /enhance --mode <档位> <文本>'),
  template: z.union(['', ...ENHANCE_TEMPLATES]).default(DEFAULT_CONFIG.template).description('内置模板（模板库）：把改写框定成一种具体交付形状（代码评审／缺陷报告／周报／API 文档／测试计划／重构简报）；留空 = 不用模板。模板纪律追加在档位纪律之后，同样不覆盖内置硬性约束；单次覆盖可用 /enhance <模板> <文本>'),
  shortcut: z.string().default(DEFAULT_CONFIG.shortcut).description('触发快捷键（如 ctrl+alt+e；须包含 ctrl/alt/meta 中至少一个修饰键，shift 仅可作附加，纯字母/数字或 shift+字母会被忽略；留空禁用）'),
  maxConcurrent: z.number().step(1).min(1).max(16).default(DEFAULT_CONFIG.maxConcurrent).description('宿主侧并发上限：同时进行的增强调用数，超出的请求返回 429'),
  rateLimitPerMinute: z.number().step(1).min(1).max(600).default(DEFAULT_CONFIG.rateLimitPerMinute).description('每分钟增强次数上限（滑动窗口），超出返回 429'),
  streaming: z.boolean().default(DEFAULT_CONFIG.streaming).description('增量展示：模型边写边在面板显示（仅影响显示节奏，最终结果不变；宿主或网络不支持时自动回退为一次性返回）'),
  fidelity: z.boolean().default(DEFAULT_CONFIG.fidelity).description('保真校验：改写完成后机械核对草稿里的硬事实（文件路径、标识符、版本号、URL）是否仍在；丢失的会按原样补在末尾并标注。不额外调用模型'),
  fidelityRepair: z.boolean().default(DEFAULT_CONFIG.fidelityRepair).description('保真修补：保真校验发现丢字时，再问模型一次（指出丢了什么、要求重出完整版本），最多多一次调用且只在真的丢字时发生；修补失败或为空则保留第一版'),
  contextAware: z.boolean().default(DEFAULT_CONFIG.contextAware).description('上下文感知：读取当前会话近期对话，用于消解指代、补全省略与术语约束；无历史或历史不足时自动回退为单条增强，不臆造信息'),
  contextMaxMessages: z.number().step(1).min(0).max(50).default(DEFAULT_CONFIG.contextMaxMessages).description('上下文窗口（条数）：最多参考最近多少条 user/assistant 轮次；0 表示不参考'),
  contextMaxChars: z.number().step(1).min(0).max(100000).default(DEFAULT_CONFIG.contextMaxChars).description('上下文窗口（字数）：历史片段的字符预算，从最新一条向前装配；0 表示不参考'),
  workspaceAware: z.boolean().default(DEFAULT_CONFIG.workspaceAware).description('工作区感知：读取当前会话工作目录的目录结构与关键文件节选，用于锁定真实的文件、目录与技术栈；无工作目录、无文件系统服务或读取失败时自动回退，不臆造'),
  workspaceRoot: z.string().default(DEFAULT_CONFIG.workspaceRoot).description('固定扫描的工作区绝对路径；留空跟随当前会话的工作目录'),
  workspaceMaxDepth: z.number().step(1).min(1).max(8).default(DEFAULT_CONFIG.workspaceMaxDepth).description('工作区扫描深度：目录最多向下几层（根目录算第 1 层）'),
  workspaceTreeMax: z.number().step(1).min(0).max(500).default(DEFAULT_CONFIG.workspaceTreeMax).description('目录结构最多列出多少个条目；0 表示只给文件内容、不列目录'),
  workspaceMaxFiles: z.number().step(1).min(0).max(200).default(DEFAULT_CONFIG.workspaceMaxFiles).description('最多读取多少个文件的内容；0 表示不读文件内容'),
  workspaceMaxFileChars: z.number().step(1).min(200).max(20000).default(DEFAULT_CONFIG.workspaceMaxFileChars).description('单个文件节选的字符上限，超出部分截断'),
  workspaceMaxChars: z.number().step(1).min(200).max(200000).default(DEFAULT_CONFIG.workspaceMaxChars).description('全部文件节选合计的字符上限，按文件优先级从高到低取'),
  armorEnabled: z.boolean().default(DEFAULT_CONFIG.armorEnabled).description('提示词破甲：在宿主每轮装配的系统提示词最前面插入一段你自己写的身份/行为文本（内部段名 prompt-enhance-armor）。默认关闭；开启后模型的自我设定以该文本为准。与 dsh-purge 同时开启且指向同一份文件时不会重复注入'),
  armorFile: z.string().default(DEFAULT_CONFIG.armorFile).description('破甲文本文件路径；文件存在且非空时优先生效，改文件即刻生效（按 mtime 缓存，不用重启）。支持 ~ 与 ${DSH_HOME}。留空只用下面的内联文本'),
  armorText: z.string().role('textarea').default(DEFAULT_CONFIG.armorText).description('内联破甲文本；文件缺失、为空或路径留空时使用。{{model}}/{{provider}} 之外的 {{变量}} 会被转义，避免装配期硬失败'),
  armorOrder: z.number().step(1).min(-1000000).max(100000).default(DEFAULT_CONFIG.armorOrder).description('破甲段在系统提示词里的排序值，越小越靠前；默认 -100000（排在所有内置段之前）'),
  rewriterArmor: z.boolean().default(DEFAULT_CONFIG.rewriterArmor).description('改写位声明：在「增强调用」自己的系统提示词开头声明这是改写环节、不做内容审查，并在上游把回答变成拒答时自动重试一次。默认开启；关闭后上游一旦拒答，面板会直接报「上游拒答」而不是把拒答当成增强结果'),
})

/**
 * Mark every field editable in place.
 *
 * The 0.2.x settings surface derives a plugin's section from the schema this
 * module exports and keeps only the fields whose meta is `volatile`
 * (`volatileForm()` in `@deepseek-ai/dsh-settings` filters on it in `describe()`
 * and on every write; an entry whose schema has no volatile field is skipped
 * entirely). Until 0.2.9 this schema marked none, so on that line the plugin had
 * no section at all: nothing to read it, nothing to write it. The
 * `installSettingsSection` probe in `index.ts` covered the older rc line, and
 * 0.2.x had already removed that API, so the fallback silently did nothing.
 *
 * dsh's own plugins spell this `.volatile()` from the harness' schemastery fork;
 * this package depends on the public `schemastery`, which has no such chain
 * method, so the same bit is set through the schema's public `meta`. The flag
 * only means "editable without remounting the plugin": the loader commits the
 * new values into the running config object that `apply()` already holds, which
 * is what makes a saved change reach the very next call.
 */
for (const field of Object.values((Config as { dict?: Record<string, { meta?: Record<string, unknown> }> }).dict ?? {})) {
  if (field.meta !== undefined) field.meta.volatile = true
}

/**
 * Validate and detach one resolved config. Unknown keys (leftovers from older
 * versions) are stripped — only the schema-known fields survive. The loader
 * fills schema defaults before apply; this re-checks the invariants the
 * schema cannot express (provider/model pairing, non-empty route strings) so
 * a bad stored section fails loud at the boundary instead of inside a model
 * call.
 * @param config - untrusted resolved section.
 * @returns the validated config, unknown keys removed.
 * @throws Error describing the first violated invariant.
 */
export function resolveConfig(config: Config): Config {
  if (config === null || typeof config !== 'object') throw new Error('prompt-enhance: configuration is required')
  if (typeof config.enabled !== 'boolean') throw new Error('prompt-enhance: enabled 必须是布尔值')
  const hasProvider = config.provider !== undefined && config.provider !== ''
  const hasModel = config.model !== undefined && config.model !== ''
  if (hasProvider !== hasModel) {
    throw new Error('prompt-enhance: provider 与 model 必须成对填写（要么都填，要么都留空以跟随当前会话模型）')
  }
  const provider = hasProvider ? (config.provider ?? '').trim() : config.provider
  const model = hasModel ? (config.model ?? '').trim() : config.model
  if ((hasProvider && provider === '') || (hasModel && model === '')) {
    throw new Error('prompt-enhance: provider/model 覆盖必须是非空字符串')
  }
  const temperature = config.temperature
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    throw new Error('prompt-enhance: temperature 必须是 0–1 之间的有限数字')
  }
  // Whitespace-only is "absent", not "set": the explicit pair is definitionally
  // non-empty, so a blank override strips away as `undefined` rather than
  // surviving as `''` and reading as "an override exists" downstream.
  const pairOrUndefined = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  const intInRange = (value: unknown, name: string, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`prompt-enhance: ${name} 必须是 ${min}–${max} 之间的整数`)
    }
    return value
  }
  return {
    enabled: config.enabled,
    provider: pairOrUndefined(provider),
    model: pairOrUndefined(model),
    temperature,
    maxOutputTokens: intInRange(config.maxOutputTokens, 'maxOutputTokens', 0, 32768),
    maxInputChars: intInRange(config.maxInputChars, 'maxInputChars', 200, 200000),
    timeoutMs: intInRange(config.timeoutMs, 'timeoutMs', 5000, 600000),
    systemPrompt: typeof config.systemPrompt === 'string' ? config.systemPrompt : '',
    // Tolerate absent or hand-edited values: anything but the extend literal
    // means replace, so stored sections from earlier versions keep exactly
    // the behavior they were saved under.
    strategyMode: config.strategyMode === 'extend-default' ? 'extend-default' : 'replace-default',
    // 手改过的/旧版本存的配置里可能是空值或未知串：一律回落到默认档位，
    // 于是老安装升级后行为与升级前完全一致。
    mode: isEnhanceMode(config.mode) ? config.mode : DEFAULT_CONFIG.mode,
  // 同上：未知/手改的模板串一律回落成"不用模板"，老安装升级后提示词逐字节不变。
  template: isEnhanceTemplate(config.template) ? config.template : '',
    shortcut: typeof config.shortcut === 'string' ? config.shortcut : '',
    maxConcurrent: intInRange(config.maxConcurrent, 'maxConcurrent', 1, 16),
    rateLimitPerMinute: intInRange(config.rateLimitPerMinute, 'rateLimitPerMinute', 1, 600),
    streaming: typeof config.streaming === 'boolean' ? config.streaming : DEFAULT_CONFIG.streaming,
    // Older stored sections predate the gate: absent means the default, so an
    // existing install picks the feature up on the first save (or keeps it if
    // the operator already turned it off).
    fidelity: typeof config.fidelity === 'boolean' ? config.fidelity : DEFAULT_CONFIG.fidelity,
    fidelityRepair: typeof config.fidelityRepair === 'boolean' ? config.fidelityRepair : DEFAULT_CONFIG.fidelityRepair,
    contextAware: typeof config.contextAware === 'boolean' ? config.contextAware : DEFAULT_CONFIG.contextAware,
    contextMaxMessages: intInRange(config.contextMaxMessages, 'contextMaxMessages', 0, 50),
    contextMaxChars: intInRange(config.contextMaxChars, 'contextMaxChars', 0, 100000),
    workspaceAware: typeof config.workspaceAware === 'boolean' ? config.workspaceAware : DEFAULT_CONFIG.workspaceAware,
    workspaceRoot: typeof config.workspaceRoot === 'string' ? config.workspaceRoot.trim() : '',
    workspaceMaxDepth: intInRange(config.workspaceMaxDepth, 'workspaceMaxDepth', 1, 8),
    workspaceTreeMax: intInRange(config.workspaceTreeMax, 'workspaceTreeMax', 0, 500),
    workspaceMaxFiles: intInRange(config.workspaceMaxFiles, 'workspaceMaxFiles', 0, 200),
    workspaceMaxFileChars: intInRange(config.workspaceMaxFileChars, 'workspaceMaxFileChars', 200, 20000),
    workspaceMaxChars: intInRange(config.workspaceMaxChars, 'workspaceMaxChars', 200, 200000),
    // 破甲段：缺席一律当默认（关闭），于是老安装升级后行为完全不变；
    // 手改出来的非有限数 order 回落到默认排序值，不让一段文本因为排序值坏了整轮装配失败。
    armorEnabled: typeof config.armorEnabled === 'boolean' ? config.armorEnabled : DEFAULT_CONFIG.armorEnabled,
    armorFile: typeof config.armorFile === 'string' ? config.armorFile.trim() : DEFAULT_CONFIG.armorFile,
    armorText: typeof config.armorText === 'string' ? config.armorText : '',
    armorOrder: typeof config.armorOrder === 'number' && Number.isFinite(config.armorOrder)
      ? Math.trunc(config.armorOrder)
      : DEFAULT_CONFIG.armorOrder,
    // 改写位声明：缺席按默认（开启）——它的效果是「上游拒答时不再把拒答当结果」，
    // 属于修正而不是新增行为，所以老安装升级后拿到的是修正后的行为。
    rewriterArmor: typeof config.rewriterArmor === 'boolean' ? config.rewriterArmor : DEFAULT_CONFIG.rewriterArmor,
  }
}

/**
 * The effective system prompt. An empty override always means the built-in
 * strategy. A non-empty override follows `strategyMode`: `replace-default`
 * swaps the built-in strategy out entirely (its hard rules are not retained),
 * while `extend-default` appends the custom text after the built-in strategy,
 * so those rules stay in force. Tolerates an absent field (older stored
 * sections predate the schema default).
 * @param config - the resolved config.
 * @param builtin - the built-in strategy prompt.
 * @returns the system prompt of the next call.
 */
export function effectiveSystemPrompt(config: Config, builtin: string): string {
  const custom = (config.systemPrompt ?? '').trim()
  if (custom === '') return builtin
  if (config.strategyMode === 'extend-default') {
    return `${builtin}\n\nOperator additions (follow them where they do not conflict with the rules above):\n${custom}`
  }
  return custom
}
