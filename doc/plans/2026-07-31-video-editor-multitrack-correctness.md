# 视频编辑器多轨编辑正确性 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让删除、复制、裁剪、全选和属性编辑只影响目标片段，并让一次连续交互只生成一个可撤销历史快照。

**Architecture:** 把“按片段 ID 定位所属轨道并更新”的逻辑收口到 `timelineOps.ts` 纯函数，主轨更新后顺排，叠加轨保留自由时间位置。窗口组件只负责提交持久化与历史事务，时间轴和属性检查器通过交互开始/结束回调划定一次连续操作。

**Tech Stack:** React 19、TypeScript、Vitest、IndexedDB 工程持久化。

---

### Task 1: 轨道级片段操作

**Files:**

- Modify: `src/components/videoEditor/timelineOps.ts`
- Test: `tests/services/videoEditorOps.test.ts`

1. 先增加失败测试，覆盖叠加轨裁剪不压实、按 ID 删除/复制只命中所属轨道、禁止删除工程最后一个片段。
2. 新增轨道级纯函数，并复用既有单轨函数。
3. 运行 `npx vitest run tests/services/videoEditorOps.test.ts`，预期全部通过。

### Task 2: 窗口操作与选择范围

**Files:**

- Modify: `src/components/videoEditor/VideoEditorWindow.tsx`

1. 删除通用 `updateVideoClips` 对全部视频轨执行同一 mutation 的路径。
2. 裁剪、删除、复制和主轨换序改用目标轨道操作。
3. `Ctrl+A` 与删除保护基于全部可编辑片段。
4. 分割仍只作用于播放头所在的主轨片段。

### Task 3: 连续交互历史事务

**Files:**

- Modify: `src/components/videoEditor/useTimelineHistory.ts`
- Modify: `src/components/videoEditor/VideoEditorTimeline.tsx`
- Modify: `src/components/videoEditor/VideoEditorPreview.tsx`
- Modify: `src/components/videoEditor/VideoEditorInspector.tsx`
- Modify: `src/components/videoEditor/VideoEditorWindow.tsx`
- Test: `tests/components/VideoEditorPreview.test.tsx`

1. 为历史 Hook 增加幂等的交互事务边界，同一拖拽/滑块操作只提交一次快照。
2. 时间轴拖拽、预览变换和属性滑块在 pointer 开始/结束时通知窗口。
3. 单击按钮类操作仍提交一个快照。
4. 运行定向组件测试、类型检查和 ESLint。

### Task 4: 综合验证

1. 运行全部视频编辑器测试。
2. 运行 `npm run typecheck` 与 `npm run test:typecheck`。
3. 运行改动文件定向 ESLint、`git diff --check` 和严格 UTF-8/乱码扫描。
