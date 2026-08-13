# Project Assistant Model Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 让对话助手、Agent、上下文预算和独立窗口统一优先使用当前项目默认文本模型，并在项目模型不可用时回退到应用默认。

**Architecture:** 在项目设置服务中定义无 Store 依赖的候选顺序；模型请求层负责逐个验证候选是否可调用。主窗口选择器写项目设置，独立窗口通过既有 action 交由主窗口写入，并同步解析后的有效模型 ID。

**Tech Stack:** TypeScript、React、Zustand、Vitest、既有 ChatStateSnapshot 协议；不新增依赖或数据库迁移。

---

### Task 1: 固定模型候选顺序

**Files:**
- Modify: `src/services/projectSettingsService.ts`
- Test: `tests/services/projectSettingsService.test.ts`

**Steps:**
1. 写失败测试，覆盖项目文本默认优先、空项目设置回退和重复候选去重。
2. 实现纯函数，返回项目默认与应用默认组成的稳定候选列表。
3. 运行 `npx vitest run tests/services/projectSettingsService.test.ts`。

### Task 2: 请求与上下文预算复用候选

**Files:**
- Modify: `src/services/ai/assistantStream.ts`
- Modify: `src/services/chat/contextManager.ts`
- Test: `tests/services/assistantStreamProtocol.test.ts`
- Test: `tests/services/chat/contextManager.test.ts`

**Steps:**
1. 写失败测试，证明项目模型优先且无效项目模型回退应用模型。
2. 把单 ID 解析拆为候选逐项解析，并保留现有协议和密钥边界。
3. 上下文规格读取同一项目候选，不再只读取全局 ID。
4. 运行两组定向测试。

### Task 3: 主窗口与独立窗口选择行为一致

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`
- Modify: `src/services/chat/detachedChatSyncController.ts`
- Modify: `src/services/chat/chatWindowService.ts`
- Test: `tests/services/chat/detachedChatSyncController.test.ts`
- Test: `tests/services/chat/chatWindowService.test.ts`

**Steps:**
1. 写失败测试，证明 snapshot 暴露项目有效文本模型，独立窗口选择写入项目设置。
2. 主窗口选择器显示项目模型，并通过 `updateProjectSettings` 持久化；没有项目时沿用应用配置。
3. 独立窗口 action 复用同一规则，补齐 patch 同步。
4. 运行窗口协议与控制器测试。

### Task 4: 阶段验收

**Files:**
- Modify: `doc/对话助手-Agent能力实施方案.md`

**Steps:**
1. 新增 8.25 阶段记录，明确本阶段不含自动路由和视觉输入。
2. 运行定向测试、`npm run typecheck`、`npm run test:typecheck`、阶段文件定向 ESLint、全量测试和临时目录生产构建。
3. 运行 `git diff --check` 和严格 UTF-8/乱码扫描。
4. 提交 `feat(agent): 统一项目默认助手模型`。
