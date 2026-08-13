# Agent Execution Rationale Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Agent 任务时间线中实时展示基于脱敏事件的可折叠执行依据，不暴露模型隐藏思维链。

**Architecture:** 新增纯派生服务，把既有 `AgentEvent` 与 `AgentStep` 关联成稳定展示项；独立 React 组件负责折叠和状态样式，`AgentTaskTimeline` 只负责装配。无需修改模型流协议、任务持久化结构或数据库版本。

**Tech Stack:** React 19、TypeScript、Zustand、Vitest、React DOM Server。

---

### Task 1: 执行依据派生

**Files:**
- Create: `src/services/chat/agentExecutionRationale.ts`
- Create: `tests/services/chat/agentExecutionRationale.test.ts`

**Steps:**
1. 写失败测试，覆盖模型轮次、工具提出、Policy 判定、工具结果、审批和暂停状态。
2. 写失败测试，确认工具详情只来自匹配步骤的脱敏摘要，并限制最多 16 条。
3. 实现事件到展示项的固定映射、调用关联、持续时间和重试说明。
4. 运行 `npx vitest run tests/services/chat/agentExecutionRationale.test.ts`。

### Task 2: 折叠视图

**Files:**
- Create: `src/components/chat/AgentExecutionRationale.tsx`
- Modify: `src/components/chat/AgentTaskTimeline.tsx`
- Create: `tests/components/agentExecutionRationale.test.tsx`

**Steps:**
1. 写失败渲染测试，断言标题、可验证边界、状态条目与无事件空渲染。
2. 实现活动任务默认展开、终态默认折叠的键盘可操作按钮。
3. 使用现有 `canvas-*` token 和图标 + 文字状态表达。
4. 接入任务时间线并运行组件测试与定向 ESLint。

### Task 3: 文档、验证与提交

**Files:**
- Modify: `doc/对话助手-Agent能力实施方案.md`

**Steps:**
1. 增加 8.22 阶段完成记录、安全边界和回滚说明。
2. 运行定向 Vitest、`npm run typecheck`、定向 ESLint、全量测试和临时目录生产构建。
3. 运行 `git diff --check`、严格 UTF-8 解码和常见乱码扫描。
4. 记录既有全仓检查阻断，提交 `feat(agent): 增加可折叠执行依据视图`。
