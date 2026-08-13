# MCP 全权限第一阶段实施计划

**目标：** MCP 调用现有 Tool Registry 的全部工具时不再等待内置助手审批，并解除现有 MCP 工具屏蔽。

**架构：** Policy Engine 继续作为本地固定边界，但 C 自主模式对所有已定义 effect 自动放行；MCP 执行器显式覆盖为自主权限上下文，不读取或继承内置助手会话模式。schema、工具级 `authorize`、项目与 revision 校验、路径授权、审计、取消、重试限制和 checkpoint 保持不变。

**技术栈：** TypeScript、Zustand、Vitest、现有 Tool Registry / Policy Engine / MCP loopback bridge。

---

### 任务 1：以测试固定新的权限矩阵

**文件：**

- 修改：`tests/services/chat/policyEngine.test.ts`
- 修改：`tests/services/chat/agentToolExecution.test.ts`
- 修改：`tests/services/mcp/mcpControlService.test.ts`

**步骤：**

1. 将 C 自主模式所有非只读 effect 的预期改为自动放行。
2. 将共享执行器中 `file_write` 的预期从审批步骤改为直接工具步骤。
3. 断言 MCP 工具发现包含子智能体工具，并断言 MCP 即使面对协作模式的旧专用会话也直接执行受保护工具。
4. 运行三个定向测试，确认旧实现不能满足新断言。

### 任务 2：实现 MCP 独立最大权限执行

**文件：**

- 修改：`src/services/chat/policyEngine.ts`
- 修改：`src/services/chat/agentToolExecution.ts`
- 修改：`src/services/mcp/mcpControlService.ts`

**步骤：**

1. 让 C 自主模式对 `canvas_write`、`file_write`、`permanent_delete`、`media_generation`、`memory_write`、`config_write`、`asset_write` 全部返回 `allow`。
2. 为共享工具执行入口增加仅由可信编排层提供的权限模式覆盖；工具输入不能设置该值。
3. MCP 工具发现、审计任务和实际执行始终使用 `autonomous`，不继承内置助手会话模式。
4. 移除 `agent_run_sub_agent` 与 `comfyui_execute_workflow` 的 MCP 屏蔽，但继续经过 Registry 的 `isAvailable`、schema 与 `authorize`。
5. 运行定向测试确认通过。

### 任务 3：同步产品与架构说明

**文件：**

- 修改：`src/components/HelpCenterDialog.tsx`
- 修改：`doc/adr/0004-local-mcp-control-bridge.md`
- 修改：`doc/对话助手-Agent能力实施方案.md`

**步骤：**

1. 明确 MCP 所有已注册工具无须应用内确认，并说明仍保留本地安全校验与审计。
2. 更新 ADR 的决策、风险和失败语义，移除“等待审批”旧描述。
3. 在 Agent 实施方案新增本阶段完成记录与真实验证结果。

### 任务 4：验证并提交

**步骤：**

1. 运行定向 Vitest。
2. 运行 `npm run typecheck` 和修改文件定向 ESLint。
3. 运行 `git diff --check`，严格 UTF-8 解码并扫描常见乱码字符。
4. 检查 `git status --short`，确认无无关文件。
5. 使用中文提交说明提交第一阶段。
