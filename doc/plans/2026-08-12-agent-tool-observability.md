# Agent Tool Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 为 Agent 工具调用增加安全、结构化、可折叠的参数与结果详情，并让视频生成的比例、分辨率和时长成为审批前锁定的显式参数。

**Architecture:** 在 Tool Registry 中定义通用展示快照协议，由工具构建脱敏输入详情、由执行结果返回结果详情。两个 Agent 执行入口负责持久化快照，聊天 UI 只消费快照并按当前 Store 解析安全的节点缩略图。

**Tech Stack:** React 19、TypeScript、Zustand、Vitest、Tailwind CSS。

---

### Task 1: 结构化工具快照基础设施

**Files:**
- Modify: `src/types/agent.ts`
- Modify: `src/services/chat/toolRegistry.ts`
- Modify: `src/services/chat/agentToolExecution.ts`
- Modify: `src/services/chat/agentRoundExecutor.ts`
- Test: `tests/services/chat/agentToolExecution.test.ts`
- Test: `tests/services/chat/agentRoundExecutor.test.ts`

**Steps:**
1. 先写测试，注册带 `buildInputDisplay` 和结果 `display` 的工具，断言两种执行路径保存相同快照。
2. 运行定向测试，确认新断言失败。
3. 增加 `AgentToolDisplaySnapshot`、`AgentToolDisplayField`、`AgentToolDisplayReference`、`AgentToolDisplayChange` 类型。
4. 给 `AgentToolDefinition` 增加可选 `buildInputDisplay(input, context)`；给执行结果增加可选 `display`。
5. 用安全包装器生成展示快照；异常时退化到摘要，不能阻断工具执行。
6. 运行测试确认通过。

### Task 2: 画布节点创建与修改详情

**Files:**
- Modify: `src/services/chat/tools/canvasTools.ts`
- Test: `tests/services/chat/canvasTools.test.ts`

**Steps:**
1. 写失败测试，断言创建快照包含节点类型、名称、显式/自动坐标和提示词预览。
2. 写失败测试，断言修改结果包含节点 ID、字段名、旧值和新值。
3. 实现画布输入展示构建器和更新前后差异采集；正文按固定长度裁剪。
4. 运行画布工具定向测试。

### Task 3: 媒体有效参数

**Files:**
- Modify: `src/types/media.ts`
- Modify: `src/services/chat/tools/mediaTools.ts`
- Modify: `src/services/ai/generationRuntime.ts`
- Test: `tests/services/chat/mediaTools.test.ts`
- Test: `tests/services/generationRuntime.test.ts`

**Steps:**
1. 写测试覆盖用户显式视频参数和项目默认参数两种来源。
2. 扩展 `MediaGenerationIntent`：`aspectRatio`、`resolution`、`duration`。
3. 扩展 `media_generate` schema，并在输入展示快照中记录有效值、来源、提示词预览和参考节点。
4. 审批前解析项目默认值；用户显式值优先。审批后锁定并传给 Runtime。
5. Runtime 只消费 Intent 中已解析参数，保留合理兜底以兼容旧调用者。
6. 运行媒体与 Runtime 定向测试。

### Task 4: 折叠详情 UI

**Files:**
- Create: `src/components/chat/AgentToolDetails.tsx`
- Modify: `src/components/chat/AgentStepCard.tsx`
- Modify: `src/components/chat/AgentApprovalCard.tsx`
- Create: `tests/components/agentToolDetails.test.tsx`

**Steps:**
1. 写组件测试覆盖展开、参数、变更、结果和失效素材。
2. 实现语义化展开按钮与分组详情。
3. 根据 reference 的 nodeId 从 Store 解析图片缩略图，不保存或显示本地绝对路径。
4. 在步骤卡和审批卡接入；无快照时保持旧 UI。
5. 运行组件测试和定向 ESLint。

### Task 5: 文档、验证与提交

**Files:**
- Modify: `doc/对话助手-Agent能力实施方案.md`

**Steps:**
1. 更新阶段状态、完成记录、检查结果和回滚说明。
2. 严格 UTF-8 解码并扫描常见乱码。
3. 运行相关 Vitest、`npm run typecheck`、改动文件定向 ESLint、`git diff --check`。
4. 运行 `npm run check`；如遇已知 ESLint 10 兼容问题，记录后保留定向检查结果。
5. 检查 `git status --short`，只提交本阶段文件。
6. 使用中文提交说明，例如 `feat(agent): 增强工具调用参数与变更详情`。
