# 0.2.18 — 一个 token 不再重绘整个面板

## 为什么

"有时候很卡"发生在长改写正在流式显示的时候。原因不在渲染量，在**扇出**：增量文本和面板状态共用一个 store、一个 version，于是每个 token 都被当成一次状态变更，通知所有订阅者 —— 面板头、七个档位按钮、最多十条历史、底部按钮全部重渲染一遍，而它们一个字节都没变。真正变的只有中间那个 `<pre>`。快模型能推 50–100 token/秒，主线程大半时间在重算没有变化的界面。

## 发生了什么

- **流式文本单独成一片**（`src/client/ui-state.ts`）：新增 `subscribeStreaming` / `getStreamingText`。`flushPendingDelta` 只叫醒这一片订阅者，而且**不再 bump version** —— 增量不是粗粒度状态转移。真正的状态转移（打开、落定、报错、关闭、撤销、历史、选档）照旧通知所有人。
- **只有实时正文订阅这一片**（`src/client/ResultPanel.tsx:245-277`）：新的 `StreamingBody` 负责"首个 token 前转圈 / 之后显示文本"，通过 `useSyncExternalStore` 读这一片；外层面板只订阅粗粒度状态，也不再读 `state.streaming`。
- **快照是原始值**：`getStreamingText()` 返回 `string`，`useSyncExternalStore` 按值比较，不需要缓存快照对象，也不会触发 "getSnapshot should be cached" 警告。
- **批处理不变**：0.2.9 的"同一 JS turn 内合并"原样保留，一串 token 仍然塌成一次 mutation + 一次通知，只是通知范围变窄。
- 测试：批处理回归改用流式这一片断言；新增「增量期间粗粒度订阅者不被唤醒」用例，钉住契约 —— 每次 flush 一次细粒度通知、零次粗粒度，落定后这一片清空。`tsc -p .` 干净；38 文件 / 541 用例全过。
- **这轮没做**：面板仍然渲染整段流式文本，30KB 的改写在每帧仍要排版 30KB 文字。如果那是剩下的瓶颈，下一步是"流式期间只显示尾部窗口"，而不是继续动 store。

## 验证

- 观察点：流式生成时在输入框打字、滚动会话，不再和面板抢帧。
- `vitest run`：38 文件 / 541 用例全过；`tests/preflight-built.mjs` 通过。

## 生效方式

宿主加载 `lib/`，**重启 DSH** 之后生效。
