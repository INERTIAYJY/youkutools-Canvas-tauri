# 视频编辑器可靠预览实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复第二个视频素材进入叠加轨后未探测、无缩略图且预览不显示的问题，并让多轨视频预览具备与播放头一致的播放、暂停和定位行为。

**Architecture:** `VideoEditorWindow` 统一派生全部可见视频片段并交给素材探测 Hook；`VideoEditorPreview` 继续使用主轨原生 `<video>`，同时为活动叠加视频创建独立 `<video>`，以时间轴播放头换算素材时间。素材 URL 仍统一经过 `resolveClipUrl`，不新增持久化字段或 Provider 分支。

**Tech Stack:** React 19、TypeScript、Vitest、Tauri WebView 原生媒体元素。

---

### 任务 1：补齐全轨素材探测

**文件：**

- 修改：`src/components/videoEditor/VideoEditorWindow.tsx`
- 修改：`src/components/videoEditor/useVideoEditorSources.ts`

1. 将全部可见视频轨片段传给 `useVideoEditorSources`。
2. 保持 URL 去重，避免分割片段重复探测。
3. 让选中叠加片段时检查器读取该片段自己的 probe。
4. 运行 `npm run typecheck`。

### 任务 2：修复叠加视频预览

**文件：**

- 修改：`src/components/videoEditor/VideoEditorPreview.tsx`

1. 图片叠加层继续使用 `<img>`。
2. 视频叠加层改用 `<video>`，URL 经过统一解析。
3. 根据 `playhead - timelineStart + sourceIn` 同步 `currentTime`。
4. 跟随走带状态播放/暂停，片段切出活动区间时卸载。
5. 素材加载失败时显示可识别占位，不让破图覆盖画面。

### 任务 3：回归测试与检查

**文件：**

- 测试：`tests/components/VideoEditorPreview.test.tsx`

1. 覆盖活动叠加视频渲染为 `<video>`。
2. 覆盖图片叠加层仍渲染为 `<img>`。
3. 运行定向 Vitest、改动文件 ESLint、`npm run typecheck` 和 `git diff --check`。
4. 检查 UTF-8 与常见中文乱码字符。
