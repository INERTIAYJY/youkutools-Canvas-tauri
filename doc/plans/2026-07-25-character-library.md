# Character Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 增加支持项目与全局范围、多图参考、头像裁剪和节点收纳的角色库。

**Architecture:** 复用现有 `dramaAssets` 项目角色域并向后兼容地扩展多图字段；新增 IndexedDB 全局角色 store 和通过 `fileService` 暴露的全局图片复制能力。独立角色库界面复用同一 Store Action，节点右键流程只负责收集输入，所有共享状态变更在 Store 中完成。

**Tech Stack:** Tauri 2、React 19、TypeScript 6、Zustand 5、React Flow 12、IndexedDB、Vitest、Tailwind CSS。

---

### Task 1: 多图角色类型与兼容迁移

**Files:**
- Modify: `src/types/dramaAssets.ts`
- Modify: `src/services/dramaAssetExtract.ts`
- Modify: `src/services/dramaAssetPrompt.ts`
- Modify: `src/services/nodeReferenceService.ts`
- Modify: `src/store/store.projects.ts`
- Test: `tests/services/dramaAssetExtract.test.ts`
- Test: `tests/store/projects.test.ts`

**Steps:**
1. 为参考图用途、归一化裁剪框和角色参考图建立领域类型。
2. 将项目角色库提升为版本 2，并提供纯函数规范化 v1 数据。
3. 让提取合并保留已有参考图，旧单图字段可继续被提示词和 mention 解析。
4. 在所有项目加载入口规范化角色库。
5. 运行 `npm test -- --run tests/services/dramaAssetExtract.test.ts tests/store/projects.test.ts`，预期通过。

### Task 2: 全局角色持久化

**Files:**
- Modify: `src/services/indexedDbService.ts`
- Create: `src/services/characterLibraryService.ts`
- Modify: `src/services/fileService.ts`
- Test: `tests/services/indexedDbService.test.ts`
- Create: `tests/services/characterLibraryService.test.ts`

**Steps:**
1. 先为 v16 schema 和全局角色 CRUD 编写失败测试。
2. 新增 `globalCharacters` object store，并提供读取、写入、删除和清空 API。
3. 创建角色库服务，统一复制永久参考图和清理持久化数据。
4. 保证浏览器降级模式可以保存 data URL 元数据，不调用 Tauri 文件 API。
5. 运行两个定向测试文件，预期通过。

### Task 3: Store Action 与项目/永久副本

**Files:**
- Modify: `src/store/store.dramaAssets.ts`
- Modify: `src/store/useAppStore.ts`（仅在类型聚合需要时）
- Test: `tests/store/dramaAssets.test.ts`

**Steps:**
1. 先写项目参考图追加、去重、主视觉唯一性和全局角色加载的失败测试。
2. 增加项目角色创建、参考图追加/删除、头像裁剪和项目/永久复制 Action。
3. 对项目数据变更统一静默保存；全局数据通过角色库服务持久化。
4. 运行 `npm test -- --run tests/store/dramaAssets.test.ts`，预期通过。
5. 运行阶段 1 的 typecheck、定向 ESLint、生产构建和差异检查。

### Task 4: 独立角色库界面

**Status:** Complete (2026-07-25)

**Files:**
- Create: `src/components/CharacterLibraryPanel.tsx`
- Create: `src/components/CharacterAssetDialog.tsx`
- Create: `src/components/character/CharacterReferenceGallery.tsx`
- Modify: `src/components/DramaAssetsPanel.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/store/store.ui.ts`
- Create: `src/styles/character-library.css`
- Modify: `src/index.css`

**Steps:**
1. 增加浮层开关与懒加载装配。
2. 实现“本项目 / 全局资产”、搜索、角色头像条和多图详情区。
3. 实现创建、编辑、图片用途、提示词和头像裁剪弹窗。
4. 让“短剧资产 > 人物”继续读取同一项目数据。
5. 运行类型、定向 ESLint和构建，并在桌面与窄窗口截图检查布局。

### Task 5: 节点右键入库与隐藏恢复

**Status:** Pending user confirmation after Stage 2

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/store/store.nodes.ts`
- Modify: `src/hooks/useNodeContextMenu.ts`
- Modify: `src/components/canvas/NodeContextMenu.tsx`
- Modify: `src/components/Canvas.tsx`
- Modify: `src/components/CharacterAssetDialog.tsx`
- Test: `tests/store/dramaAssets.test.ts`
- Test: `tests/components/nodeCriticalInteractions.test.tsx`

**Steps:**
1. 为图片节点资格、默认隐藏、关联线过滤、恢复和删除角色兜底编写失败测试。
2. 添加条件右键项“添加到角色库…”，打开已有角色/新建角色弹窗。
3. 角色持久化成功后通过 Store Action 隐藏节点，并提交一次历史快照。
4. 渲染层过滤连接隐藏节点的边；恢复后选择并聚焦原节点。
5. 删除角色时恢复关联隐藏节点；缺失节点时允许从角色卡创建新节点。
6. 运行全部相关测试、`npm run typecheck`、`npm run test:typecheck`、定向 ESLint、临时目录 Vite 构建和 `git diff --check`。

### Task 6: 最终回归与文档记录

**Files:**
- Modify: `doc/plans/2026-07-25-character-library-design.md`（仅在实现偏离已确认设计时）

**Steps:**
1. 严格 UTF-8 解码所有改动文本并扫描常见乱码。
2. 手动验证旧项目升级、项目切换、永久角色重启恢复、多图追加、头像裁剪、隐藏/恢复和撤销。
3. 检查 `git status --short`，确认发布说明等用户改动未被纳入。
4. 按阶段使用中文 Conventional Commit 提交，仅暂存本阶段文件。
