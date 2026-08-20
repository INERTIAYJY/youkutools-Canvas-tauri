# 即梦 CLI 完整适配 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 按即梦 CLI v1.4.17 的官方能力补齐模型目录、参数约束、首尾帧与全模态命令路由，并让应用安全更新已缓存的旧 CLI。

**Architecture:** 用独立的即梦模型能力表作为模型菜单、参数面板和生成入口的共同真值；前端根据参考素材角色选择 CLI 子命令，Rust 层只负责本地化素材、拼装受控参数、提交和查询。CLI 更新采用“临时下载、探活、原子替换、失败回退旧版”，不影响离线用户继续使用已缓存版本。

**Tech Stack:** React 19、TypeScript 6、Vitest 4、Tauri 2、Rust、官方 dreamina CLI

---

### Task 1: 建立即梦模型能力表

**Files:**
- Create: `src/services/ai/dreaminaModels.ts`
- Create: `tests/services/dreaminaModels.test.ts`
- Modify: `src/components/nodes/shared/defaultModels.ts`
- Modify: `tests/components/defaultModels.test.ts`

**Steps:**
1. 先编写失败测试，覆盖官方图片与视频模型 ID、Seedance 2.5 的 1080p/30 秒限制、2.0 VIP 的 4K 限制。
2. 运行定向测试，确认旧目录缺少对应模型。
3. 实现声明式能力表，并让默认模型目录复用该清单。
4. 再次运行定向测试并确认通过。

### Task 2: 实现 CLI 安全更新和完整命令参数

**Files:**
- Modify: `src-tauri/src/dreamina.rs`

**Steps:**
1. 将 CLI 缓存更新改为定期检查：下载到临时文件、探活后替换，下载或探活失败时保留可用旧版。
2. 扩展 `GenerateParams`，支持首帧、尾帧、参考图片、参考视频和参考音频。
3. 增加 `frames2video` 与 `multimodal2video` 的受控参数拼装。
4. 将首次网页合规确认错误转换成可操作的中文提示。
5. 运行 Rust 定向测试与 `cargo check --lib`。

### Task 3: 接通前端命令路由与参数约束

**Files:**
- Modify: `src/services/dreaminaService.ts`
- Modify: `src/services/ai/generateVideo.ts`
- Modify: `src/components/nodes/shared/VideoParamSelector.tsx`
- Create: `tests/services/dreaminaService.test.ts`

**Steps:**
1. 编写纯参数构建测试，覆盖文生视频、单首帧、明确首尾帧、混合媒体和 Seedance 2.5 音频单独参考。
2. 实现纯参数构建函数，根据素材与角色选择 `text2video`、`image2video`、`frames2video`、`multimodal2video`。
3. 在生成入口按模型能力校验参考素材数量、分辨率和时长。
4. 参数面板接入即梦能力表，让每个模型只显示实际支持的档位。
5. 运行前端定向测试。

### Task 4: 完整验证

**Files:**
- Verify all modified files

**Steps:**
1. 运行改动文件定向 ESLint。
2. 运行 `npm run typecheck`。
3. 运行相关 Vitest 测试。
4. 在 `src-tauri/` 运行 `cargo test dreamina --lib` 和 `cargo check --lib`。
5. 运行 `git diff --check`，严格 UTF-8 解码全部改动文本并扫描常见乱码。
6. 检查 `git status --short`，确认没有无关改动。
