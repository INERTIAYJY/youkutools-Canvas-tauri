# Seedling（森之灵）CLI 视频生成能力接入说明

> 日期：2026-08-14
> 分支：`feat/seedling-cli-integration`
> 类型：平台能力（新增厂商视频生成执行能力）

## 背景与目标

在画布视频节点与对话 Agent 中接入森之灵（Seedling）CLI 视频生成能力：

1. **视频节点**：视频节点模型选择器可选 Seedling 模型（动态来自 `seedling models list`），参数面板按模型能力约束时长/分辨率/比例/参考图/配乐。
2. **对话 Agent**：注册受控 Agent 工具（`seedling_list_models` / `seedling_create_video` / `seedling_query_task`），走现有 Tool Registry / Policy Engine 边界。
3. **双认证方式并存**：
   - 方式 A：CLI 浏览器授权登录（`seedling auth login`，登录令牌由 CLI 配置文件持久化，90 天有效）。
   - 方式 B：API Token（机器令牌，永久），应用设置中填写，经 `providerSecretService` 存入 Rust `secret_store`，运行时以 `SEEDLING_TOKEN` 环境变量传给 CLI（CLI 优先级：环境变量 > 配置文件）。
4. **CLI 管理**：混合模式——优先检测系统已安装 CLI（PATH → 标准安装目录 → 应用数据目录缓存），缺失或版本过低时从官方 CDN 下载缓存固定版本（参考 `dreamina.rs` 的 `dreamina_cli` 模式）。

## CLI 接口（v0.0.7 官方文档 + 实测）

| 命令 | 说明 |
|---|---|
| `seedling task create --prompt --model --duration[4-15] --resolution[480p/720p/1080p] --ratio --audio --resource(可多次) --json` | 提交视频生成任务（立即返回 taskId） |
| `seedling task get <id>` / `task list --status --limit --offset --json` | 查询任务 |
| `seedling task wait/cancel/delete/download` | 等待/取消/删除/下载任务 |
| `seedling resource upload <file>` | 上传本地素材，返回在线 URL |
| `seedling models list --json` | 模型列表 + 能力 + 繁忙状态 |
| `seedling auth login/status/logout/set-token` | 认证 |
| `seedling config set/get/list`、`seedling version`、`seedling update` | 配置与维护 |
| `seedling mcp-server` | MCP Server 模式（后续可选接入） |

## 架构分层

```
前端节点/对话
   │
   ├─ src/services/ai/providers/seedlingMedia.ts  媒体 Provider Adapter（providerId='seedling'）
   │     └─ 注册进 mediaProviderRegistry
   ├─ src/services/seedlingService.ts             前端服务层（invoke 封装 + pollTask 轮询）
   ├─ src/services/chat/tools/seedlingTools.ts    Agent 受控工具（registerAgentTool）
   └─ src/components/settings/SeedlingSettings.tsx 设置页（双认证 + CLI 状态 + 模型列表）
   │
   └─ Tauri 受控命令（src-tauri/src/seedling.rs，lib.rs 注册）
         seedling_cli_status / seedling_models / seedling_task_create / seedling_task_get /
         seedling_task_list / seedling_task_cancel / seedling_task_download /
         seedling_resource_upload / seedling_auth_login_start / seedling_auth_login_runtime /
         seedling_auth_login_cancel / seedling_auth_logout
```

### 关键设计

- **Provider 目录**：`providerCatalogService.ts` 新增 `seedling` 定义（`catalogAdapter: 'seedling-cli'`），模型经 `seedling models list --json` 拉取并映射为 `ProviderModelSelection`（含 `videoCapability`）。
- **节点分组**：`defaultModelGroups` 新增 `seedling` 分组（模型动态填充）；`getConfiguredModelGroups` 与 `ModelSelector` 的可用性判断为「API Token 或 CLI 登录态任一可用」。
- **参数能力**：`VideoParamSelector` 读取目录模型的 `videoCapability`（分辨率/比例/时长/配乐），时长按 CLI 约束 4~15 秒钳制。
- **对话路由**：`generationRuntime.resolveMediaModel` 对 `seedling` 单独校验认证（不要求 apiKey 字段），通用媒体工具经 `@模型` 引用即可路由。
- **结果处理**：Adapter 返回 `videoUrl`，上层 `downloadUrlAndSave` 统一落盘到项目目录（与 dreamina/APIMart 一致）。

## 安全边界

- Rust 命令全部参数白名单/枚举校验（resolution/ratio/duration/status/limit），禁止任意参数拼接。
- API Token 只进 `SEEDLING_TOKEN` 环境变量，绝不进命令行参数、日志或返回结果；持久化走 `secret_store`。
- `seedling_task_download`（`--output`）与 `seedling_resource_upload`（本地路径）必须经过 `path_policy` 的 `ensure_trusted_caller` 与 `authorize_path` 授权校验。
- Agent 工具 `seedling_create_video` 的参考素材只接受 http(s) URL，不接受本地路径。
- CLI stdout 按 UTF-8 解码（Windows 下避免 GBK 乱码）；错误信息截断回传。

## 验证方式

- Rust：`cargo check --lib`；`cargo test seedling::tests --lib`（参数校验/版本解析/认证解析）
- 前端：`npm run typecheck`；`npx vitest run tests/services/seedlingMedia.test.ts tests/services/seedlingService.test.ts`
- 手工：设置 → 森之灵 → 检测 CLI/认证 → 视频节点选择 Seedling 模型生成 → 对话 `@` 引用 Seedling 模型生成

## 边界与已知限制

- CLI 最低版本按 0.0.4 兼容设计；旧版本缺失 `task delete` 等能力时以错误信息回传。
- 模型 ID 差异：`models list` 返回 `quality` 等基础 ID，历史任务参数显示 `quality-oii` 变体；提交任务使用 `models list` 的 ID。
- `seedling auth login` 的交互登录在应用内通过「授权链接 + 配对码」引导完成（`--no-browser --json`），登录态由 CLI 配置文件持久化。
- 应用内下载的 CLI 与系统 CLI 读取同一 `%APPDATA%\seedling` 配置文件，登录态共享。
