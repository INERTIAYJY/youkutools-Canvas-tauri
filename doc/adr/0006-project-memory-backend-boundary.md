# ADR-0006：项目记忆采用本地权威 Repository 与可选远端适配器

## 状态

Accepted（第一阶段仅实现本地 Repository 与 TencentDB L1 映射，不启用网络同步）

## 背景

AI Canvas 已有项目记忆：Agent 只能通过 `memory_suggest` 提议，用户确认后保存简短的偏好、事实、约束或决定；记录按项目隔离，可编辑、禁用、删除并保留来源生命周期。当前 IndexedDB 是唯一权威源，Context Manager 在本地完成相关性排序和 1500 token 预算选择。

TencentDB Agent Memory v3 提供 L0 Conversation、L1 Atomic、L2 Scenario 和 L3 Core，并要求 `teamId / agentId / userId` 严格隔离；可选 `taskId` 适合承载 AI Canvas 的项目维度。官方 TypeScript SDK 当前为 Node 包，依赖 `undici` 并要求 Node 18，不能直接进入 Tauri WebView。远端服务还需要 `sk-mem-*` 用户密钥和自托管端点，真实连接必须遵守本项目 Rust 凭据存储与网络安全边界。

## 决策

1. 保留 IndexedDB 作为默认且离线可用的项目记忆权威源。
2. 在 `projectMemoryService` 下抽取 `ProjectMemoryRepository`，完整表达现有保存、按项目读取、删除、项目改挂和来源失效语义；Store 与 Context Manager 的公开行为不变。
3. TencentDB 只作为未来用户显式开启的可选远端镜像与检索增强，不直接替换本地记录。
4. 只把用户已经确认的 `ProjectMemory` 映射到 L1 Atomic；默认不上传 L0 完整对话、网页正文、文件正文、Skill 或工具 Observation。
5. 项目 ID 映射为 v3 `task_id`，本地记忆 ID 映射为 Atomic `id`；`kind / enabled / source / timestamps / projectId` 放入带版本号的 `background` JSON，以支持无损往返和未来迁移。
6. 第一阶段只实现纯映射契约，不新增 SDK、设置项、密钥字段、HTTP 请求、数据库版本或 Tauri command。
7. 后续真实同步必须独立实施：密钥只存 Rust `secret_store`，端点必须由受限 Tauri command 校验，采用本地成功优先的 outbox/重试，远端失败不得阻断本地记忆，并提供用户可见的同步状态与手动关闭/清理能力。

## 后果

### 正面

- 保持离线、确认、编辑、禁用和删除语义不变。
- Store 不感知具体数据库，未来可增加远端镜像或其他后端。
- TencentDB 映射可在无服务、无密钥、无付费模型的环境中稳定测试。
- 不把 Node SDK、用户密钥或任意远端请求引入 WebView。

### 负面

- 第一阶段不会带来跨设备同步或语义向量检索。
- 真实双写需要 outbox、冲突策略、凭据 UI、健康检查和删除补偿，不能靠简单 `Promise.all` 完成。
- TencentDB L1 的服务端 `type` 不能由当前 `updateAtomic` 请求直接指定，因此 AI Canvas 类别必须保存在版本化 `background` 中。

### 中性

- 远端 L2/L3 和 Skill/Wiki/CodeGraph 不属于现有“项目记忆”替换范围，未来应作为独立能力评估。

## 备选方案

### 直接用 TencentDB 替换 IndexedDB

拒绝。会破坏离线能力，并使用户确认后的编辑、禁用、来源失效和项目删除依赖远端可用性。

### Store 同时直接调用 IndexedDB 与 TencentDB

拒绝。会把网络、重试、冲突和凭据规则泄漏到 Zustand slice，且部分成功时难以恢复。

### 通过 TencentDB Proxy 代理全部助手模型请求

暂不采用。它会改变现有多 Provider 路由、工具调用和确认边界，范围远超项目记忆适配。

## 参考

- TencentDB Agent Memory README：分层记忆、严格隔离和按需检索
- TencentDB Agent Memory TypeScript SDK v3：`updateAtomic/queryAtomic/searchAtomic/deleteAtomic`
- `doc/对话助手-Agent能力实施方案.md` P3-D2 与本地凭据、网络安全规则
