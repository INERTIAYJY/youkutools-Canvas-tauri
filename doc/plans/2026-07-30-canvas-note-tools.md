# Canvas Note Tools Implementation Plan

> **For Codex:** Implement this plan task by task and verify each layer before moving on.

**Goal:** 在现有 React Flow AI 画布中加入一套独立的轻量笔记与绘图工具，复刻 Excalidraw 的工具条和按工具切换的属性面板，不复用 AI 节点业务语义和快捷键。

**Architecture:** 所有笔记元素统一保存为 `canvas-note` React Flow 节点，使用 `note.kind` 区分图形、线条、手绘、文本和图片。React Flow 继续负责坐标、选择、移动和项目持久化；SVG 负责轻量绘制；现有 Store Action 和 history slice 负责可撤销写入。

**Tech Stack:** React 19、TypeScript、React Flow 12、Zustand 5、Tailwind CSS、自定义 CSS、Lucide React、Vitest。

---

### Task 1: Data model and geometry

**Files:**
- Create: `src/types/canvasNote.ts`
- Create: `src/utils/canvasNoteGeometry.ts`
- Modify: `src/types/index.ts`
- Test: `tests/utils/canvasNoteGeometry.test.ts`

1. 为图形、线条、手绘、文本和图片定义判别联合类型及默认样式。
2. 编写边界框、点归一化、箭头路径和手绘路径的纯函数测试。
3. 运行 `npx vitest run tests/utils/canvasNoteGeometry.test.ts`，确认测试通过。

### Task 2: Store operations and history

**Files:**
- Modify: `src/store/store.nodes.ts`
- Modify: `src/store/store.history.ts`
- Modify: `tests/store/history.test.ts`

1. 增加笔记元素的原子样式更新、复制、删除和四种层级移动 Action。
2. 将 `note` 数据作为结构化历史字段，使一次样式或几何操作可由一次撤销恢复。
3. 运行 history 定向测试，确认不改变普通 AI 节点的既有历史语义。

### Task 3: Note node rendering

**Files:**
- Create: `src/components/noteNodes/CanvasNoteNode.tsx`
- Create: `src/components/noteNodes/CanvasNoteShape.tsx`
- Create: `src/components/noteNodes/CanvasNoteText.tsx`
- Create: `src/components/noteNodes/CanvasNoteImage.tsx`

1. 使用 SVG 渲染矩形、菱形、椭圆、箭头、直线和手绘路径。
2. 使用独立编辑态实现普通笔记文本双击编辑。
3. 图片笔记复用项目文件存储及现有裁剪组件，不出现模型、提示词和生成状态。
4. 为选中元素提供稳定的缩放控制点和无障碍名称。

### Task 4: Toolbar, property panel, and pointer interaction

**Files:**
- Create: `src/components/canvas/CanvasDrawingToolbar.tsx`
- Create: `src/components/canvas/CanvasNoteStylePanel.tsx`
- Create: `src/hooks/useCanvasDrawing.ts`
- Modify: `src/components/Canvas.tsx`

1. 接入选择、矩形、菱形、椭圆、箭头、直线、手绘、文本、图片和橡皮擦模式。
2. 根据当前工具或单选笔记节点显示对应属性组。
3. 绘制期间使用 flow 坐标生成预览，结束时只提交一次历史快照。
4. 图片工具先选择本地图片，再在画布放置；橡皮擦只影响 `canvas-note`。
5. 不注册 Excalidraw 数字键或字母键快捷键。

### Task 5: Styling, snapshots, and verification

**Files:**
- Create: `src/styles/canvas-drawing.css`
- Modify: `src/index.css`
- Modify: `src/services/projectSnapshotService.ts`
- Modify: `src/services/projectSnapshotWorker.ts`
- Create: `tests/components/canvasNoteTools.test.tsx`

1. 将 Excalidraw 浮动 island、按钮尺寸、浅紫选中态和属性分组适配到项目主题 token，并限制在 `canvas-drawing-*` 作用域。
2. 项目缩略图识别笔记图片和基础图形，不把属性面板录入画布内容。
3. 运行定向 Vitest、`npm run typecheck`、改动文件 ESLint、临时目录生产构建、`git diff --check` 和严格 UTF-8 扫描。
4. 启动开发服务器，在桌面与窄窗口验证工具条、属性面板、绘制、编辑、缩放、层级、橡皮擦和主题显示。

### Rollback

删除新增组件、类型、几何和样式文件，并回退 `Canvas.tsx`、Store、history、snapshot 与 `index.css` 的接入点即可。旧版本不会渲染已保存的 `canvas-note`，但其 JSON 数据不会覆盖或破坏现有 AI 节点。
