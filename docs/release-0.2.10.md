# 0.2.10 — the rewrite call stops handing back refusals

*本次改动只有一个目标：**上游把「帮我改写这段草稿」当成「生成草稿所指的内容」而拒答时，面板不再把拒答当成增强结果。***

## 问题

截图里的那条：原文「写个 18+ 的话 色情点 有鸡巴和逼的描写」→ 增强结果是一段拒答（「这个我没法帮你改写……如果你实际想要的是……我可以帮你……」）。插件本身没有拦，请求确实发出去了；是上游模型对**草稿的题材**做了内容审查，把评审意见当成了答案。

## 改法（两层，互不替代）

| 层 | 位置 | 作用 |
| --- | --- | --- |
| 改写位声明 `rewriterArmor` | `src/prompts.ts` 的 `REWRITE_STANCE` + `withRewriteStance()` | 在**增强调用自己的**系统提示词最前面声明：这是改写环节，不是内容审查员、不是内容作者；不判断题材、不写政策说明、不给替代方案 |
| 拒答识别与一次重试 | `src/shared/refusal.ts` 的 `isRefusalReply()`，`src/enhancer.ts` 的 `retryRefusal()` | 认出拒答 → 追加 `REWRITE_STANCE_ESCALATION` 重试一次；仍然拒答 → 报 `upstream / reason=refused`（带「换成不做审查的模型」的修法提示），绝不把拒答当结果返回 |

## 边界

- **只加一次重试，不循环。** 与 fidelity repair 同样的纪律：第二次仍拒答就终态报错，不反复烧 token。
- **改写位声明不覆盖内置策略。** 它管「这次调用要不要做」，策略管「怎么写」；不编造、只输出正文、跟随语言这三条永远在。
- **顺序**：拒答闸在锚点闸之前 —— 拒答文本不进入字面事实校验。
- **流式**：重试不再吐 delta（面板已经把第一版拒答流出去了，第二版再冒出来会像卡顿）。
- **可关**：`rewriterArmor: false` → 请求与 0.2.10 之前逐字节一致，拒答原样出现在结果框。
- **与破甲是两件事**：`armorEnabled` 改的是宿主聊天每轮的系统提示词；`rewriterArmor` 改的是增强这条辅助调用。两者互不依赖。

## 判据（`isRefusalReply`）

拒答短语落在回复**前 240 字符**，**且**全文没有提示词骨架（`##` 标题、`-` 列表、`1.` 步骤、`角色/要求/输出格式` 这类标签、`You are…` / `你是…` 的角色指派）→ 判定为拒答。

代价是可控的：误判只多花一次调用，不会把用户没看过的结果偷换成别的东西；截断式扫描换来的是「改写正文里引用了『抱歉』不会被误杀」。

## 验证

- `tsc -p . --pretty false` → 0
- `vitest run` → **34 files / 482 tests** 全过（新增 `tests/refusal.test.ts` 8 例；`tests/enhancer.test.ts` 新增 refusal gate 5 例；`tests/prompts.test.ts` 新增 `withRewriteStance` 4 例）
- `scripts/build.mjs` → 0，`lib/index.js` 内含 `isRefusalReply`（711）、拒答闸（793）、`refusalRetry`（1597）
- `tests/preflight-built.mjs` → `apply() returned without throwing: true`

## 怎么用

默认就开着。若上游仍然拒答（有些模型对题材极敏感，声明也压不住），最有效的一步是**换模型**：插件设置里成对填 `provider` / `model`，把增强指向本地或自建的不做内容审查的模型，然后重试。`rewriterArmor` 只是让「改写」这件事被正确理解，不能把一个做过对齐的模型变成不审查的模型。
