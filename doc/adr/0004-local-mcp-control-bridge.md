# ADR 0004：使用会话级本地 MCP 控制桥

## 状态

已接受，2026-07-24；2026-08-20 增补 Streamable HTTP 远程传输。

## 背景

AI Canvas 的录制和批量操作需要比 Windows 坐标自动化更稳定的控制面。项目已经具备 Tool Registry、Policy Engine、Agent Runtime、任务时间线、画布 revision、文件 grant 和媒体逐次审批，但没有标准的外部工具协议。直接让外部进程访问 Zustand、IndexedDB、任意 HTTP、Shell 或文件系统会绕过现有安全边界，也会破坏主窗口 Store 的唯一写入源约束。

目标是在应用明确开启的本地会话中，让 Codex 等 MCP 客户端发现和调用现有 Agent 工具，同时保留项目、会话、任务、审计、撤销和模型选择语义。自 2026-08-13 起，MCP 被明确授予全部已注册工具的无人值守执行权，不依赖内置助手模式或审批卡；该放权不包含 API Key 读取、通用 Shell、任意路径读写、通用 HTTP 或绕过 Tool Registry。

## 决策

1. 本机模式使用官方 `@modelcontextprotocol/sdk` 实现 stdio MCP 适配器；远程模式使用官方 Rust SDK `rmcp` 实现 Streamable HTTP，禁止自行维护 MCP 初始化、消息 framing、工具发现和协议兼容。
2. stdio 适配器只连接 Tauri 在 `127.0.0.1` 创建的内部 TCP 端口。Streamable HTTP 仅在用户明确选择并确认高风险提示后监听 IPv4 `0.0.0.0`，统一暴露 `/mcp` endpoint。
3. 回环协议使用版本化、限长的单行 JSON。每个请求携带令牌；Rust 在把请求发送到 WebView 前移除令牌。无效令牌、超长帧、未知方法、超时和过期会话均返回固定错误，不写入业务状态。
4. Rust 仅承担端口、鉴权、会话生命周期、请求关联和 Tauri Event 转发。它不解释 Agent 工具、不访问 IndexedDB，也不执行画布、媒体、文件或配置操作。
5. 主窗口 MCP 控制服务是唯一请求处理者。工具发现来自现有 Tool Registry；调用继续经过本地 schema、可用性、Policy Engine、执行前项目与授权复核、只读重试、画布 checkpoint 和结果脱敏。
6. 每个项目按需创建标题为“`MCP 控制`”的专用对话。每次调用创建可持久化 AgentTask 和步骤，Policy、失败、revision 与撤销 checkpoint 使用现有任务时间线展示。
7. MCP 会话默认关闭。256 位固定令牌只进入 Rust 会话内存、应用凭据存储和用户主动复制的客户端配置；不进入 IndexedDB、Agent 摘要或日志。停止、窗口关闭或应用退出立即中止当前连接；用户可轮换令牌使旧客户端配置失效。
8. MCP 工具发现、审计任务和实际执行固定使用可信本地编排层提供的 `autonomous` Policy 上下文。全部 effect 均无须审批，客户端也不需要、且不能调用审批解决接口。
9. MCP 暴露当前 Tool Registry 中所有通过 `isAvailable` 的领域工具，包括会产生模型开销的子智能体和动态 ComfyUI 工作流。调用仍必须通过本地 schema、工具 `authorize`、项目/revision、文件 grant 与路径策略校验。
10. 不增加通用 Shell、任意路径文件、任意 HTTP、直接 Store 写入或直接 Provider 调用。
11. 安装包携带由 esbuild 生成的单文件 stdio 适配器资源，运行时不再依赖安装目录中的 `node_modules`；源脚本与生成步骤仍留在 `scripts/`。

## 非功能要求

- **安全性**：stdio 固定 IPv4 loopback；远程 HTTP 必须显式确认后才监听 `0.0.0.0`。两者均使用 256 位令牌；HTTP 额外要求 Bearer Token，只接受 IP literal、localhost 或固定 Docker 宿主别名，存在 Origin 时必须与 Host 同源，并限制 1 MiB 请求体与 4 个并发请求。
- **一致性**：所有业务写入仍从主窗口 Store 发起；项目 ID、会话 ID、task ID 和 canvas revision 在执行前复核。
- **可恢复性**：连接或适配器失败不影响应用；停止会话后待处理请求失败且不能在新会话重放。
- **可审计性**：每个 MCP 工具调用都有 AgentTask、Policy 决策、步骤结果和可选画布 checkpoint。
- **兼容性**：stdio 与 Streamable HTTP 均使用官方 SDK；内部回环协议带版本字段，宿主与适配器版本不匹配时明确失败。
- **性能**：单次会话最多 4 个活跃客户端或 HTTP 请求；请求按连接与序号隔离，长时间工具可取消且不阻塞 UI 线程。

## 失败策略

- 端口绑定失败时保持关闭并在设置页显示错误。
- 认证失败后立即返回错误并关闭连接，不向前端发事件。
- HTTP 请求缺少 Bearer Token、Host 不是 IP/localhost、Origin 不同源或正文超限时，在进入主窗口前直接拒绝。
- 前端未就绪、请求超时或会话被停止时，适配器收到结构化错误；写工具不自动重试。
- 应用切换项目后，尚未执行的调用在执行前复核失败；不会写入新项目。
- 工具级授权、项目/revision、文件 grant 或路径策略校验失败时，任务记录为拒绝或失败；MCP 收到脱敏错误文本。
- stdio 客户端退出不会自动重新开启会话；用户可在设置页停止后重新生成令牌。

## 未采用方案

- **Windows 坐标自动化**：窗口大小、焦点、缩放和动画会导致不稳定，且难以建立审计和撤销边界。
- **前端直接启动 stdio MCP**：WebView 不应持有子进程和标准输入输出能力，也会扩大 Tauri capability。
- **固定端口或持久令牌**：方便配置但扩大本机驻留攻击面，不符合手动会话授权。
- **外部进程直连 IndexedDB/Store**：绕过项目隔离、历史、Policy 和主窗口单写源。
- **MCP 自带审批工具**：MCP 已由可信本地编排层固定为最大权限，不需要额外审批协议或可伪造的自批接口。
- **手写 MCP 协议栈**：短期减少依赖，但初始化、兼容、取消和 framing 的长期维护风险更高。
- **直接把内部 TCP bridge 暴露到局域网**：虽然改动较小，但不是标准 Streamable HTTP，远端仍需复制适配器与依赖，且扩大自定义协议的攻击面。
- **Node HTTP sidecar**：可以复用 TypeScript SDK，但引入额外子进程、安装包依赖和生命周期故障点，不如 Rust 进程内 transport 稳定。

## 影响

- 使用随机端口或轮换令牌后需要更新客户端配置；固定端口与未轮换的凭据可保持不变。
- AI Canvas 必须保持运行且主窗口已初始化，外部 MCP 工具才可用。
- 付费媒体、子智能体、文件写入、永久删除和配置写入会直接执行；调用方需要自行控制请求范围和费用。
- 远程 HTTP 是明文局域网传输，不作为公网服务；公网或跨不可信网络使用时必须由用户自行配置 VPN/TLS 反向代理与网络访问控制。
- 新增 esbuild 开发依赖用于打包 stdio 适配器，并新增 `rmcp`、Axum、Tower 与 Tokio HTTP 运行能力。

## 回滚

先在设置页停止 MCP 会话。若只回滚远程能力，移除 `streamable-http` 配置分支、Rust HTTP handler 与新增 Cargo 依赖，并恢复本机连接说明；stdio 与现有审计链可继续使用。若同时回滚安装包修复，再移除适配器构建脚本和 Tauri resource 映射。回滚不涉及数据库、项目或凭据迁移。
