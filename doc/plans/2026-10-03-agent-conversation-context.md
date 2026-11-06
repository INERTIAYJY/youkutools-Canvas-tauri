# Agent 对话续接与 Pi 上下文机制接入

状态：两阶段代码与自动验证已完成。第二阶段按用户要求不进行桌面/浏览器验收，真实模型对话质量尚未验证。

## 范围与来源

第一阶段改善“继续上一任务”“修改刚才结果”和长工具链的上下文衔接，复用现有 Runtime、Store、Registry 与 Policy，不替换整个 Agent 框架。

改编来源为 [Pi](https://github.com/earendil-works/pi)，固定 revision `a276dabe57911253350bffb93cb7d7aff6a73261`。接入 `compaction.ts` 的倒序预算与有效切点算法、`utils.ts` 的带角色序列化，适配应用自己的消息与工具快照。MIT 许可与改编说明随应用分发在 [Pi-LICENSE.txt](../../public/licenses/Pi-LICENSE.txt)、[Pi-NOTICE.txt](../../public/licenses/Pi-NOTICE.txt)。没有新增 npm/cargo 依赖。

源码入口：

- [contextTranscript.ts](../../src/services/chat/contextTranscript.ts)：完整历史轮次、工具调用/结果切点、脱敏任务记录与压缩输入序列化。
- [contextManager.ts](../../src/services/chat/contextManager.ts)：同项目、同会话历史结果注入，按连续完整轮次保留最近历史。
- [contextCompressionService.ts](../../src/services/chat/contextCompressionService.ts)：历史压缩与执行中的内存 checkpoint，项目模型路由、取消与结果校验。
- [agentRuntime.ts](../../src/services/chat/agentRuntime.ts)：续聊规则与模型轮次前的压缩接入。

## 行为与固定边界

- “继续”“按刚才的方案做”“修改刚才结果”结合近期对话和执行记录解释；明确的新目标仍不能自动触发历史中的其他请求。普通问答允许直接完整回答。
- 历史工具记录只从消息关联的同项目、同会话 AgentTask 注入，包含状态、结果摘要与节点/资产引用；不复制原始参数或网页、文件正文。不完整的活动消息占位不进入历史，暂停后的 partial 回复仍可使用。
- 历史裁剪保留连续的最近完整用户轮次，不跳过一段大历史后重新塞入更早的小消息；压缩覆盖边界不能拆开同时间戳消息。
- 执行消息达到约 90% 输入预算时尝试压缩早期内容，保留系统规则、当前用户目标、执行中补充要求和最近工具调用/结果对。摘要需包含规定区段及来源、节点/资产锚点；压缩无效或仍超限时暂停。固定目标与最近完整工具组本身过大时仍不能自动继续。
- 执行 checkpoint 仅在当前请求数组内存中替换，保持数组身份及任务步骤/画布 checkpoint，保留恢复写入去重。摘要请求禁用工具，使用任务项目模型，并把执行压缩的 token 与耗时计入任务指标；原有轮次、工具与终身预算仍复核。
- 历史摘要沿用原持久化类型与 Store Action；取消、会话离开当前内存或摘要版本发生变化后不写回。没有数据库 schema、工具权限或桌面安全配置变更。

## 第一阶段自动验证与验收缺口

- 定向 Vitest：`agentConversationContext`、`contextManagerSources`、`contextCompression`、`agentRuntimeDiagnostics`、`agentApproval`、`agentRoundExecutor`。
- 前端与测试类型：`npm run typecheck`、`npm run test:typecheck`。
- 修改的四个源码文件与两个测试文件通过定向 ESLint。
- Vite 生产构建输出到系统临时目录；许可文件随 public 资源输出。构建存在大 chunk 与静态/动态重复导入提示，不作为运行时正确性的证据。
- UTF-8 编码与差异空白检查通过。

自动用例覆盖续聊工具结果与真实引用、无文本工具回复、连续轮次裁剪、跨项目/会话隔离、项目切换时的模型路由、取消与停止、无效摘要暂停、执行压缩后继续完成、恢复写入去重。模型请求由测试替身提供，因此不能据此认定真实模型的主观对话质量已经改善。

尚未完成：真实厂商多轮对话、桌面双窗口、重启后实机续接与付费媒体验收。当前只改上下文与续聊，不接入 Pi 的 Provider、文件/进程工具、会话存储或整个执行器。

## 第二阶段：执行收尾与工具说明

参考同一 Pi revision 的 `packages/agent/src/agent-loop.ts`（结束前接收补充消息、拦截截断工具调用）与 `packages/coding-agent/src/core/system-prompt.ts`（按启用工具组装说明），在现有执行器内修复对应缺口，没有引入 upstream 执行器或新增依赖。

- [agentPromptGuidance.ts](../../src/services/chat/agentPromptGuidance.ts) 从系统提示词中拆出工具说明；[agentRoundExecutor.ts](../../src/services/chat/agentRoundExecutor.ts) 每轮使用 Registry 的实际工具名称与当前模式刷新同一条宿主系统消息，包含对应的 Skill/子智能体索引。初始画布信息仍由 [assistantStream.ts](../../src/services/ai/assistantStream.ts) 提供，避免重复注入静态工具规则。
- 纯文本回复结束前再次接收执行中补充消息，将前一轮回复和追加要求一并带入后续模型轮次；原有轮次、工具、终身预算及恢复写入去重继续生效。
- 接收 `done.finishReason`。`length` 保留已生成正文并暂停，本轮工具不计为已执行、不会请求审批或触发副作用；`error` / `canceled` 也不能落入正常完成或工具执行。`conversationExecutionController.ts` 刷新正文后保存 `partial + length`，任务时间线使用中文暂停提示。
- `memoryTools.ts`、`fileTools.ts`、`providerConfigTools.ts` 同步修正工具声明与配置预览 Observation 中的确认文案。Plan 预览不要求保存，B 请求审批，C 自动执行；文件保存仍保留原生位置选择，所有权限与执行器不变。

本阶段只处理这三类缺口。完整请求的工具 schema/图片预算、usage 校准与临时模型请求错误重试留待后续；不把调整提示词等同于真实模型对话质量已经改善。按用户要求不启动桌面或浏览器验收服务。

本阶段自动验证：`assistantStreamProtocol`、`agentRoundExecutor`、`agentRuntimeDiagnostics`、`conversationExecutionController`、`subAgentTools`、`agentApproval`、`agentConversationContext`、`providerConfigTools`、`policyEngine`、`contextManagerSources`、`contextCompression`、`agentInterjection`，共 12 个文件、218 项 Vitest 用例通过；`npm run typecheck`、`npm run test:typecheck`、修改的源码/测试文件定向 ESLint 通过；严格 UTF-8、乱码扫描与 `git diff --check` 通过。新增用例覆盖工具受限后的说明、B/C 文案、纯文本追加要求、预算暂停、模式切换、截断工具拦截、取消/错误终止和 partial 正文保留。本阶段未运行生产构建、真实模型或桌面验收。

第二阶段可独立回滚：撤回工具说明模块及调用、单轮收尾判断、partial 写回与文案修改即可；没有数据库迁移或权限变化。第一阶段的上下文续接保留。

## 回滚

撤回上述源码改动、移植辅助文件及其引用即可恢复原对话链路；没有依赖升级、数据库迁移或历史删除。期间生成的历史摘要仍使用既有 formatVersion 2，可由原版本读取。
