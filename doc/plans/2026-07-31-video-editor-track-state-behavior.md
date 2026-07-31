# 视频编辑器轨道状态闭环 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让轨道锁定、隐藏和静音在时间轴、预览、属性编辑与导出之间保持一致行为。

**Architecture:** 轨道状态继续保存在 `VideoEditorTrack`，不新增 schema。窗口层集中执行锁定授权，预览层根据轨道状态决定画面可见性和媒体静音，时间轴与检查器只负责反馈和阻止入口操作；导出继续复用现有 `hidden` / `muted` 过滤。

**Tech Stack:** React 19、TypeScript、原生 HTMLMediaElement、Vitest、CSS。

---

### Task 1: 锁定查询与窗口保护

**Files:**

- Modify: `src/components/videoEditor/timelineOps.ts`
- Modify: `src/components/videoEditor/VideoEditorWindow.tsx`
- Test: `tests/services/videoEditorOps.test.ts`

1. 增加按片段 ID / 轨道 ID 查询锁定状态的纯函数测试。
2. 删除、复制、分割、属性修改、整轨删除和层级调整统一拒绝锁定目标。
3. 混合选择删除时只删除未锁定片段，锁定片段保留。

### Task 2: 预览隐藏与静音

**Files:**

- Modify: `src/components/videoEditor/VideoEditorPreview.tsx`
- Test: `tests/components/VideoEditorPreview.test.tsx`

1. 主轨隐藏时保持媒体走带但不绘制画面且强制静音。
2. 主轨静音只关闭声音，不隐藏画面。
3. 叠加视频按轨道静音，并阻止锁定轨道的画面拖拽。
4. 活动音频轨使用 `<audio>` 跟随播放头，隐藏或静音轨不发声。

### Task 3: 时间轴与检查器反馈

**Files:**

- Modify: `src/components/videoEditor/VideoEditorTimeline.tsx`
- Modify: `src/components/videoEditor/VideoEditorInspector.tsx`
- Modify: `src/styles/video-editor.css`

1. 锁定片段禁用右键修改、整轨删除和层级调整。
2. 隐藏、静音和锁定轨道显示稳定的弱化/状态样式。
3. 检查器对锁定片段禁用变换、转场和音量输入。

### Task 4: 验证

1. 运行所有视频编辑器测试。
2. 运行前端与测试类型检查、改动文件定向 ESLint。
3. 运行 `git diff --check` 与严格 UTF-8/乱码扫描。
