# 受控 SPA 文档渲染 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 为匿名公开 API 文档增加同源、无持久登录态的 SPA 渲染回退，让 `web_extract` 能读取 JavaScript 渲染后的正文。

**Architecture:** 现有静态 GET 与正文提取保持首选路径；仅在 HTML 呈现 SPA 页面壳且正文不足时调用新的 Tauri 隐私 WebView 命令。原生命令复用公网 URL 校验，限制同源导航、写请求、弹窗和下载，通过 `eval_with_callback` 返回有上限的渲染 HTML，随后立即销毁窗口。

**Tech Stack:** Tauri 2 / Rust、TypeScript、Vitest、Cargo tests。

---

### Task 1: 固化前端回退判定

**Files:**
- Modify: `src/services/webPageService.ts`
- Test: `tests/services/webPageService.test.ts`

1. 为 HTML 静态响应增加可测试的 SPA 页面壳判定。
2. 先写静态正文不回退、空 `#root` 页面回退、普通短页面不误判的测试。
3. 在 `readWebPage` 中最多调用一次 `assistant_web_render`，并继续复用既有正文、链接和裁剪逻辑。
4. 运行 `npx vitest run tests/services/webPageService.test.ts`。

### Task 2: 实现原生隔离渲染

**Files:**
- Modify: `src-tauri/src/assistant_web.rs`
- Modify: `src-tauri/src/lib.rs`

1. 为 HTTPS URL、同源导航、渲染大小和超时增加纯函数与 Rust 单测。
2. 创建唯一标签的隐藏隐私 WebView，拒绝跨域顶层导航、弹窗和下载。
3. 注入只读网络保护脚本，阻止表单、非 GET 请求、WebSocket、EventSource 和 `sendBeacon`。
4. 页面加载后等待正文短暂稳定，通过 `eval_with_callback` 返回截断前的渲染 HTML，并保证成功、失败和超时都关闭窗口。
5. 在 Tauri handler 注册 `assistant_web_render`。
6. 运行 `cargo test assistant_web::tests --lib` 与 `cargo check --lib`。

### Task 3: 收敛 Agent 行为与文档

**Files:**
- Modify: `src/services/chat/tools/webTools.ts`
- Modify: `tests/services/chat/webTools.test.ts`
- Modify: `doc/对话助手-Agent能力实施方案.md`

1. 更新 `web_extract` 描述，说明匿名同源 SPA 会自动回退，登录页和跨域依赖不受支持。
2. 确保渲染失败返回一次明确错误，不诱导模型重复搜索同一页面。
3. 更新阶段完成记录、检查结果和剩余手测风险。
4. 运行定向 Vitest、定向 ESLint、TypeScript 类型检查、Rust 检查、`git diff --check` 与 UTF-8 检查。

### Task 4: Tauri 真实页面验收

**Files:**
- No source changes expected.

1. 在 Tauri 开发环境调用派谱 Seedance 文档 URL。
2. 确认结果包含 `/v1/videos`、`lec-seedance-videos-stable` 和 `duration`，且渲染窗口不可见并在完成后销毁。
3. 如当前环境无法启动桌面运行时，在阶段记录中明确标注未执行项和残余风险。
