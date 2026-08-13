# MCP Complete Control Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 为 MCP 增加界面、窗口、视口、截图和现有业务域的完整结构化控制工具。

**Architecture:** 新工具保持 MCP 专用并复用 Tool Registry、固定自主 Policy、现有 Store Action 与持久化服务。运行时界面能力通过内存服务桥接 React Flow、Tauri Webview 和 `html-to-image`，不进入持久化层。

**Tech Stack:** Tauri 2、React 19、TypeScript、Zustand、React Flow、html-to-image、MCP SDK、Vitest。

---

### Task 1: 固定界面、窗口、视口与图像协议

**Files:**

- Create: `tests/services/chat/uiControlTools.test.ts`
- Create: `tests/services/mcp/mcpImageResult.test.ts`
- Modify: `tests/services/mcp/mcpControlService.test.ts`

1. 为布局读取、交互状态、窗口状态、视口读取与控制、截图写失败测试。
2. 断言全部工具仅在 MCP 会话可发现，读取与写入 effect 准确。
3. 断言 MCP 结果允许受限 `image` 内容且文本行为保持兼容。
4. 运行定向测试，确认因工具和图像类型缺失而失败。

### Task 2: 实现界面运行时与控制工具

**Files:**

- Create: `src/services/mcp/mcpUiRuntimeService.ts`
- Create: `src/services/chat/tools/uiControlTools.ts`
- Modify: `src/services/canvasViewportService.ts`
- Modify: `src/components/Canvas.tsx`
- Modify: `src/main.tsx`
- Modify: `src/services/chat/tools/index.ts`
- Modify: `src/types/mcp.ts`
- Modify: `scripts/ai-canvas-mcp.mjs`

1. 注册 React Flow 视口读取、设置、适配和按节点聚焦能力。
2. 汇总 Store 面板、弹窗、活动节点、会话停靠和忙碌状态。
3. 查询固定应用窗口标签的尺寸、位置、焦点和显示状态。
4. 提供结构化布局设置、窗口聚焦/边界设置和视口控制。
5. 注册 Webview DOM 截图响应器，遮盖敏感元素并压缩图像。
6. 扩展 MCP 图像内容类型与桥接帧限制，保持文本结果兼容。
7. 运行界面、MCP 和 Registry 定向测试。

### Task 3: 补齐工作流、Skill、预设、风格和记忆工具

**Files:**

- Create: `src/services/chat/tools/workflowTools.ts`
- Create: `src/services/chat/tools/styleTools.ts`
- Modify: `src/services/chat/tools/skillTools.ts`
- Modify: `src/services/chat/tools/presetTools.ts`
- Modify: `src/services/chat/tools/memoryTools.ts`
- Modify: `src/services/chat/tools/index.ts`
- Create/Modify: `tests/services/chat/*Tools.test.ts`

1. 以失败测试固定各域 list/get/create/update/delete schema 与脱敏结果。
2. 复用现有 Store Action，不接受任意路径、密钥或完整配置对象。
3. 对需要文件选择器的 Skill 上传保留现有交互工具，新增内容型创建仅使用安全 Manifest 字段。
4. 运行各域定向测试和类型检查。

### Task 4: 补齐剧集、素材、会话、任务和历史工具

**Files:**

- Modify: `src/services/chat/tools/seriesTools.ts`
- Modify: `src/services/chat/tools/dramaAssetTools.ts`
- Create: `src/services/chat/tools/conversationTools.ts`
- Create: `src/services/chat/tools/historyTools.ts`
- Modify: `src/services/chat/tools/index.ts`
- Create/Modify: `tests/services/chat/*Tools.test.ts`

1. 固定分集增改、排序和删除，人物/场景/道具/声音素材 CRUD。
2. 固定会话列表、创建、重命名、切换、删除和 AgentTask 查询/控制。
3. 固定撤销、重做、历史查询、条目删除和清理工具。
4. 复用项目删除清理、任务中止、历史持久化和共享素材语义。
5. 运行定向测试和类型检查。

### Task 5: 补齐高级画布工具

**Files:**

- Modify: `src/services/chat/tools/canvasTools.ts`
- Modify: `tests/services/chat/canvasTools.test.ts`

1. 为复制、画布笔记更新/图层、图片节点转换、分组/解组/重命名、连线、分镜格和镜头表绑定写失败测试。
2. 每个写操作同时校验 `projectId` 与 revision，并只提交一次历史快照。
3. 调用现有 Store Action，返回结构化受影响节点摘要。
4. 运行画布工具定向回归。

### Task 6: 文档、全量验证与提交

**Files:**

- Modify: `doc/对话助手-Agent能力实施方案.md`

1. 分批记录真实完成项、验证结果、限制和回滚方案。
2. 运行改动文件定向 ESLint、`npm run typecheck`、`npm run test:typecheck`、全量 Vitest。
3. 运行外部临时目录生产构建、`git diff --check`、严格 UTF-8 和乱码扫描。
4. 每个可独立回滚阶段使用中文提交说明提交。
