# MCP Streamable HTTP 与本地适配器修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 修复安装版找不到本地 MCP 适配器的问题，并在保留 loopback stdio 的同时提供显式授权的 `0.0.0.0` Streamable HTTP MCP 服务。

**Architecture:** 现有主窗口 Tool Registry、Policy、审计和 Store 单写源保持不变。Rust bridge 抽取统一的前端请求转发器；stdio 继续走受令牌保护的内部 TCP，远程入口使用官方 `rmcp` Streamable HTTP transport，将 `tools/list`、`tools/call` 和取消请求转发给同一前端控制服务。远程模式默认关闭，启用前在设置页明确确认最大权限风险，并使用 Bearer Token、Origin/Host 校验、限长和并发限制。

**Tech Stack:** Tauri 2、Rust、`rmcp`、Axum、React 19、TypeScript、Vitest、Cargo test。

---

### Task 1: 固定传输配置与失败测试

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/types/mcp.ts`
- Modify: `src/services/mcp/mcpBridgeService.ts`
- Modify: `src/services/mcp/mcpSessionConfig.ts`
- Test: `tests/components/mcpControlSettings.test.ts`

1. 为配置增加 `mcpTransport: 'stdio' | 'streamable-http'`，会话信息增加绑定地址、传输和 HTTP endpoint。
2. 先增加配置生成、地址展示与远程模式参数的失败测试。
3. 实现最小 TypeScript 配置归一化和 Tauri command 参数映射。
4. 运行 `npx vitest run tests/components/mcpControlSettings.test.ts`。

### Task 2: 原生 Streamable HTTP 服务

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/mcp_bridge.rs`
- Modify: `src-tauri/src/lib.rs`

1. 增加 `rmcp` Streamable HTTP、Axum 与 Tokio 网络能力依赖。
2. 为绑定范围、Bearer Token、Origin/Host、端口冲突和会话停止写 Rust 失败测试。
3. 抽取统一前端请求转发器，实现官方 Streamable HTTP `ServerHandler`，只映射工具发现和调用。
4. 本地 stdio 固定 `127.0.0.1`；远程 HTTP 固定 `0.0.0.0`，endpoint 为 `/mcp`。
5. 运行 `cargo test mcp_bridge::tests --lib` 与 `cargo check --lib`。

### Task 3: 设置页高风险确认与客户端配置

**Files:**
- Modify: `src/components/settings/McpControlSettings.tsx`
- Modify: `src/components/settings/mcpConnectionRequirements.ts`
- Modify: `src/i18n/locales/en-US/settings.ts`
- Test: `tests/components/mcpControlSettings.test.ts`

1. 增加本机 stdio / Streamable HTTP 传输选择。
2. 切换到远程模式时显示不可绕过的确认弹窗，明确列出永久删除、文件写入、付费媒体和配置写入会自动执行。
3. HTTP 模式显示 endpoint 和 Bearer Token 客户端配置；重置令牌立即重启当前会话。
4. 根据传输更新连接要求和状态文案，确认暗色/浅色均使用现有 token。
5. 运行组件定向测试、TypeScript 类型检查和定向 ESLint。

### Task 4: 修复安装版 stdio 适配器

**Files:**
- Modify: `scripts/ai-canvas-mcp.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/mcp_bridge.rs`
- Test: `tests/scripts/aiCanvasMcp.test.mjs`

1. 将 stdio 适配器构建为不依赖安装目录 `node_modules` 的单文件资源。
2. 把单文件适配器加入 Tauri bundle resources，并优先从资源目录解析。
3. 对开发目录和安装资源目录候选路径增加测试。
4. 运行适配器测试并执行一次前端生产构建到系统临时目录。

### Task 5: 回归、安全说明与阶段记录

**Files:**
- Modify: `doc/adr/0004-local-mcp-control-bridge.md`
- Modify: `doc/对话助手-Agent能力实施方案.md`

1. 记录远程暴露的安全边界、确认流程、默认值、失败策略和回滚方案。
2. 运行 MCP 前端测试、Rust 定向测试、`cargo check --lib`、`npm run typecheck`、`npm run test:typecheck`、`git diff --check` 和严格 UTF-8/乱码扫描。
3. 检查 `git status --short`，仅暂存本任务文件；保留用户的 `AINodeDialog.tsx` 与 `panels.css` 改动。
4. 按阶段使用中文 Conventional Commit 提交。
