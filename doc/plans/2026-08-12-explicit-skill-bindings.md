# Explicit Skill Bindings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 把用户显式选择的 Skill 捕获为 AgentTask 不可变快照，并在每次执行和恢复时直接注入模型上下文。

**Architecture:** `skillPromptService` 负责捕获、预算、工具上限和展开；AgentTask 只持久化受限快照。对话控制器在任务创建时绑定，在执行时只消费任务快照；旧任务保留实时解析兼容路径。

**Tech Stack:** React 19、TypeScript、Zustand、IndexedDB、Vitest。

---

### Task 1: Skill 快照领域逻辑

**Files:**
- Modify: `src/types/agent.ts`
- Modify: `src/services/skillPromptService.ts`
- Modify: `tests/services/skillPromptService.test.ts`

**Steps:**
1. 写失败测试：显式引用捕获 ID、名称、版本、正文与 `allowedTools`。
2. 写失败测试：最多 4 个 Skill、单个 12,000 字符、合计 24,000 字符。
3. 写失败测试：快照展开不读取当前 `userSkills`，并保留不可信边界。
4. 实现 `captureExplicitSkillBindings`、`expandSkillBindings` 和 `resolveSkillBindingToolAllowlist`。
5. 运行 `npx vitest run tests/services/skillPromptService.test.ts`。

### Task 2: AgentTask 持久化与执行链

**Files:**
- Modify: `src/store/store.agent.ts`
- Modify: `src/services/chat/agentTaskService.ts`
- Modify: `src/services/chat/conversationExecutionController.ts`
- Modify: `tests/services/chat/agentTaskService.test.ts`
- Modify: `tests/services/chat/conversationExecutionController.test.ts`

**Steps:**
1. 写失败测试：旧任务读取为无绑定，新任务重启恢复保留快照。
2. 写失败测试：控制器在创建任务时捕获正文和工具上限。
3. 扩展 `CreateAgentTaskInput` 与 `AgentTask` 可选字段，并在 Store 中复制绑定数组。
4. 新任务使用快照 allowlist；执行时优先 `expandSkillBindings`，旧任务回退实时展开。
5. 运行任务持久化和控制器定向测试。

### Task 3: 用户可见状态

**Files:**
- Modify: `src/components/chat/AgentTaskTimeline.tsx`
- Create: `tests/components/agentTaskSkillBindings.test.tsx`

**Steps:**
1. 写失败测试：任务时间线显示每个已注入 Skill 的名称和“已注入”状态。
2. 使用现有 canvas token 实现紧凑标识，不展示正文。
3. 运行组件测试和定向 ESLint。

### Task 4: 文档、验证与提交

**Files:**
- Modify: `doc/对话助手-Agent能力实施方案.md`

**Steps:**
1. 更新完成状态、真实检查结果和回滚说明。
2. 运行定向 Vitest、`npm run typecheck`、定向 ESLint、生产构建和 `git diff --check`。
3. 严格 UTF-8 解码并扫描常见乱码。
4. 运行全量检查；既有阻断单独记录。
5. 使用中文提交说明 `feat(agent): 固定显式 Skill 任务上下文`。
