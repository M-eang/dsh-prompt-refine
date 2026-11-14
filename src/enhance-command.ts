/**
 * The `/enhance` slash command: rewrites its argument text through the same
 * host routine as the composer button and shows the result in the command
 * plane (copyable, never entering model history). Enhancing the composer
 * draft itself stays a client-side concern (button / shortcut), because the
 * draft lives in the browser.
 * @module dsh-prompt-refine/enhance-command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import { checkInputText, formatInputCheckZh } from './shared/validate'
import { ENHANCE_TEMPLATES, isEnhanceTemplate } from './shared/templates'
import { ENHANCE_MODES, isEnhanceMode, type EnhanceMode } from './shared/modes'
import { type Config } from './config'
import { formatEnhanceError, toEnhanceError } from './enhancer'
import { runEnhance, sessionRouteOf } from './orchestrate'

/** Structural face of the commands registry (optional service). */
interface CommandsFace {
  register(definition: CommandDefinition): () => void
}

/**
 * Register the /enhance command on the (optional) commands service. Absent
 * service is a silent no-op so the plugin still loads in UI-less spines.
 * @param ctx - registrant context.
 * @param readConfig - per-call config reader.
 */
export function registerEnhanceCommand(ctx: Context, readConfig: () => Config): void {
  const commands = ctx.get('commands') as unknown as CommandsFace | undefined
  if (commands === undefined) return
  const definition: CommandDefinition = {
    name: 'enhance',
    description: '提示词增强：/enhance <文本>、/enhance --mode <档位> <文本> 或 /enhance <模板> <文本> —— 重写为结构化提示词，结果在此展示可复制，不进入对话历史',
    input: { hint: '要增强的文本；开头可加 --mode <档位>（/enhance modes 看列表）或内置模板 id（/enhance templates 看列表）；增强输入框草稿请用输入框按钮或快捷键' },
    recordInput: false,
    async handler(invocation: CommandInvocation) {
      const raw = invocation.rawInput.trim()
      if (raw === '') {
        return { kind: 'error', text: '用法：/enhance <文本>。要增强输入框里的草稿，请用输入框右侧的「增强」按钮或快捷键。' }
      }
      // 单次档位覆盖（档位）：显式 `--mode <id>` / `-m <id>`。不做裸首词识别 ——
      // standard/spec/creative 这些 id 本身可能就是正文的第一个英文单词，吃掉它们
      // 比让用户多打一个开关更糟。未知 id 直接报错，避免以为换了档位其实没换。
      let mode: EnhanceMode | undefined
      let text = raw
      const modeFlag = /^(?:--mode|-m)\s+(\S+)(?:\s+([\s\S]*))?$/.exec(text)
      if (modeFlag !== null) {
        const candidate = (modeFlag[1] ?? '').toLowerCase()
        if (!isEnhanceMode(candidate)) {
          return { kind: 'error', text: `未知档位：${modeFlag[1]}。可用档位：${ENHANCE_MODES.join('、')}` }
        }
        mode = candidate
        text = (modeFlag[2] ?? '').trim()
        if (text === '') {
          return { kind: 'error', text: `--mode ${mode} 后面还需要正文。用法：/enhance --mode <档位> <文本>。` }
        }
      }
      // 单次模板覆盖（模板库）：首个词是内置模板 id 时用它，并从要改写的正文里
      // 摘掉；`templates`/`模板`、`modes`/`档位` 只列清单。不认识的首词一律当正文
      // —— 命令的第一个词经常就是正文的一部分，猜错把它吃掉比不识别模板更糟。
      const firstSpace = text.search(/\s/)
      const head = (firstSpace === -1 ? text : text.slice(0, firstSpace)).toLowerCase()
      if (head === 'templates' || head === '模板') {
        return { kind: 'success', text: `内置模板：${ENHANCE_TEMPLATES.join('、')}\n用法：/enhance <模板> <文本>，例如 /enhance code-review 帮我看下这段改动` }
      }
      if (head === 'modes' || head === '档位') {
        return { kind: 'success', text: `增强档位：${ENHANCE_MODES.join('、')}\n用法：/enhance --mode <档位> <文本>，例如 /enhance --mode engineering 帮我把这个需求写成施工单；只影响这一次，不改设置。` }
      }
      let template: string | undefined
      if (isEnhanceTemplate(head)) {
        template = head
        text = firstSpace === -1 ? '' : text.slice(firstSpace).trim()
        if (text === '') {
          return { kind: 'error', text: `模板 ${head} 后面还需要正文。用法：/enhance <模板> <文本>，例如 /enhance ${head} 帮我……` }
        }
      }
      const config = readConfig()
      if (!config.enabled) {
        return { kind: 'error', text: '提示词增强已在插件设置中关闭。' }
      }
      const check = checkInputText(text, config.maxInputChars)
      if (!check.ok) {
        return { kind: 'error', text: formatInputCheckZh(check) }
      }
      try {
        const value = await runEnhance(ctx, config, {
          text,
          sessionRoute: sessionRouteOf(ctx, invocation.agent.session.id),
          signal: invocation.signal,
          sessionId: invocation.agent.session.id,
          ...(template === undefined ? {} : { template }),
          ...(mode === undefined ? {} : { mode }),
        })
        // A capped rewrite comes back as a SUCCESS, so this plane has to say
        // that it is partial — showing it as a finished rewrite would be the
        // silent truncation the plugin refuses to do everywhere else.
        if (value.truncated === true) {
          return { kind: 'success', text: `${value.text}\n\n（已达输出上限，以上内容可能不完整；如设置了 maxOutputTokens 可调大或改为 0（不限）。）` }
        }
        return { kind: 'success', text: value.text }
      } catch (error) {
        return { kind: 'error', text: formatEnhanceError(toEnhanceError(error)) }
      }
    },
  }
  ctx.effect(() => commands.register(definition))
}
