# MCP 项目管理工具实施计划

**目标：** 让 MCP 通过 Tool Registry 无确认地完成项目查询、创建、重命名、切换、设置、保存和永久删除。

**架构：** 新增独立 `projectTools.ts`，只编排现有 Project Store Action，不复制项目持久化、剧集重定向、目录重命名补偿或删除清理逻辑。所有工具继续经过本地 schema、Policy、审计任务与脱敏结果；项目设置只开放结构化业务字段，不接收本地路径、快照、API Key 或任意配置对象。

**技术栈：** TypeScript、Zustand、现有 Tool Registry / Policy Engine、Vitest。

---

### 任务 1：以测试固定项目工具协议

**文件：**

- 新增：`tests/services/chat/projectTools.test.ts`
- 修改：`tests/services/mcp/mcpControlService.test.ts`

**步骤：**

1. 断言 `project_list`、`project_get` 为 `read`。
2. 断言 `project_create`、`project_rename`、`project_switch` 为 `canvas_write`。
3. 断言 `project_update_settings` 为 `config_write`、`project_save` 为 `file_write`、`project_delete` 为 `permanent_delete`。
4. 覆盖项目列表脱敏、创建/重命名/切换、设置深合并、保存与删除结果。
5. 断言 MCP 工具发现包含项目查询和删除工具。
6. 运行定向测试，确认未实现工具导致失败。

### 任务 2：实现并注册项目管理工具

**文件：**

- 新增：`src/services/chat/tools/projectTools.ts`
- 修改：`src/services/chat/tools/index.ts`

**步骤：**

1. 定义无 `additionalProperties` 的本地 schema；名称、提示词和模型引用设置长度上限。
2. 查询结果只返回 ID、名称、剧集关系、更新时间与结构化安全设置，不返回目录、路径、快照或素材正文。
3. 写工具调用 `createProject`、`renameProject`、`switchProject`、`updateProjectSettings`、`saveCurrentProject`、`deleteProject`。
4. 设置更新按 `visualStyle`、`promptSuffixes`、`defaultModels`、`generation` 深合并，不允许写入 `styleReference.filePath/imageUrl`。
5. 每个操作返回稳定摘要、JSON 模型内容和明确错误码。
6. 运行项目工具与 MCP 控制定向测试。

### 任务 3：更新阶段记录并完成验证

**文件：**

- 修改：`doc/对话助手-Agent能力实施方案.md`

**步骤：**

1. 新增 MCP 项目管理工具完成记录和回滚说明。
2. 运行定向 ESLint、`npm run typecheck`、`npm run test:typecheck`、全量 Vitest 与临时目录生产构建。
3. 运行 `git diff --check`、严格 UTF-8 与常见乱码扫描。
4. 检查工作区并使用中文提交说明提交本批次。
