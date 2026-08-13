# 项目记忆后端抽象与 TencentDB 适配验证设计

## 需求

### 功能需求

- 现有项目记忆的创建、更新、加载、删除、项目改挂和来源失效行为保持不变。
- 默认无需网络、账号、密钥或 Docker 服务。
- 能把一条 `ProjectMemory` 无损映射为 TencentDB Agent Memory v3 L1 Atomic 请求，并从 Atomic 响应恢复。
- 不能把未确认候选、完整对话、文件或网页正文自动发送到远端。

### 非功能需求

- 本地读写成功路径不增加网络延迟，远端不可用时不影响现有功能。
- API Key 不进入配置、IndexedDB、消息、日志或映射结果。
- 新接口可测试、可替换，现有 Store 与 Context Manager 无需知道后端类型。
- 第一阶段不新增依赖、数据库版本、Tauri 权限或安全配置。

## 架构

```text
Store / Project lifecycle
          │
          ▼
 projectMemoryService ── sanitize / sort / stable public API
          │
          ▼
 ProjectMemoryRepository
          │
          └── IndexedDbProjectMemoryRepository（当前唯一启用）

 ProjectMemory ── pure mapper ── Tencent v3 L1 Atomic contract
                                      │
                                      └── future secure Tauri transport（本阶段不实现）
```

Repository 覆盖完整本地语义，而不是只有 CRUD：`save`、`listByProject`、`deleteById`、`deleteByProject`、`reassignProject`、`markConversationSourceUnavailable`。`createProjectMemoryService(repository)` 让测试和未来路由可注入；模块顶层继续导出原函数并绑定 IndexedDB 实现，调用方无需迁移。

Tencent 映射使用 v3 strict isolation：外部配置提供 `teamId/agentId/userId`，AI Canvas `projectId` 固定映射为 `task_id`。Atomic `content` 只包含已脱敏的 500 字符记忆正文；`background` 是 `ai-canvas.project-memory/v1` JSON，保存类别、启用状态、来源和时间戳。解析器采用 fail-closed：schema、项目、字段或正文不合法时返回 `null`，不能把任意远端 Atomic 注入可信项目记忆。

## 失败模式

| 场景 | 第一阶段行为 | 未来同步要求 |
|---|---|---|
| IndexedDB 失败 | 沿用现有错误与 Store 日志 | 不变 |
| background 非法 | 映射解析返回 `null` | 记录脱敏诊断，不注入 |
| 远端离线/超时 | 本阶段无网络请求 | 本地成功，outbox 延迟重试 |
| 远端冲突 | 本阶段不发生 | 本地 `updatedAt` 优先，显式冲突状态 |
| 删除只完成一侧 | 本阶段不发生 | tombstone/outbox 补偿，禁止静默复活 |
| 密钥泄露风险 | 映射类型不含密钥 | Rust secret_store + 受限 command |

## 验收

- 既有 Store 调用签名与 Context Manager 行为不变。
- Repository 契约测试覆盖全部六项操作。
- Tencent 请求字段与当前 v3 SDK一致；映射往返保留全部 `ProjectMemory` 字段。
- 错误 schema、跨项目和超长/空正文被拒绝。
- 全量前端测试、两套类型检查、定向 Lint、生产构建、UTF-8 与差异检查通过或如实记录既有阻断。
