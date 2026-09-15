# 原生下拉框统一使用 UI Kit

## 目标与状态

任务类型：产品能力中的交互样式统一。用户已确认完整范围，并强调弹层层级和父容器 overflow 裁剪问题；实施与验证完成，用户已授权提交。

应用源码共有 71 个 JSX 原生 select：26 个业务文件内 69 处，加上共享 Select 和样式演示各 1 个隐藏控件。目标是业务界面全部使用共享 Select，演示也复用真实组件，最终仅保留共享组件内部必要的原生控件。

## 实施清单

以下路径均相对仓库根目录。

### 共享控件及样式演示

- `src/components/shared/Select.tsx`：补齐迁移所需的自动聚焦、必填、辅助说明及编辑事件兼容，核对键盘、禁用、Portal 与长列表交互。
- `src/components/styleGuide/StyleGuideSections.tsx`：演示直接复用共享 Select。

### 角色、工作流和对话

- `src/components/CharacterAssetDialog.tsx`（9 处）
- `src/components/WorkflowPanel.tsx`（1 处）
- `src/components/canvas/CanvasRadialMenu.tsx`（1 处）
- `src/components/chat/AgentApprovalCard.tsx`（1 处）
- `src/components/runninghub/RunningHubWorkflowImport.tsx`（5 处）

### 节点和预设

- `src/components/nodes/DirectorDeskNode.tsx`（1 处）
- `src/components/nodes/AINodeDialog.tsx`：宿主使用更早注册的 window 捕获 Escape，增加下拉优先处理边界，避免菜单关闭时一并关闭节点弹窗。
- `src/components/nodes/PluginNode.tsx`（2 处）
- `src/components/nodes/shared/PresetAdvancedEditor.tsx`（3 处）
- `src/components/nodes/shared/PresetRunnerDialog.tsx`（1 处）
- `src/components/nodes/shared/PromptPanel.tsx`（5 处）
- `src/components/nodes/shared/VideoParamSelector.tsx`（1 处）
- `src/components/nodes/shared/image/CameraStudioPanel.tsx`（2 处）
- `src/components/nodes/shared/image/composer/ComposerSidePanel.tsx`（2 处）
- `src/components/nodes/shared/image/composer/ImageComposerEditor.tsx`：键盘宿主识别 UI Kit 控件，避免选择选项时方向键移动图层、Delete 删除图层。
- `src/components/nodes/shared/toolbar/NodePluginToolDialog.tsx`（2 处）

### 设置与连接

- `src/components/settings/McpControlSettings.tsx`（1 处）
- `src/components/settings/ModelProtocolEditor.tsx`（16 处）
- `src/components/settings/ProtocolImportPanel.tsx`（1 处）
- `src/components/settings/SubAgentSettings.tsx`（1 处）
- `src/components/settings/providerConnection/ProviderConnectionForm.tsx`（1 处）
- `src/components/settings/providerConnection/ProviderModelSection.tsx`（1 处）
- `src/components/settings/providerConnection/ProviderWorkflowSection.tsx`（1 处）
- `src/components/settings/providerConnection/VideoCapabilityEditor.tsx`（5 处）

### 视频编辑器

- `src/components/videoEditor/VideoEditorAiTransitionPanel.tsx`（2 处）
- `src/components/videoEditor/VideoEditorInspector.tsx`（2 处）
- `src/components/videoEditor/VideoEditorPreview.tsx`（1 处）
- `src/components/videoEditor/VideoEditorTransitionPanel.tsx`（1 处）

### 验证与记录

必要时适配以下既有组件测试的控件定位与回调，保留业务断言：

- `tests/components/runninghubWorkflowImport.test.tsx`
- `tests/components/providerWorkflowSection.test.tsx`
- `tests/components/providerConnectionForm.test.tsx`
- `tests/components/nodePluginToolDialog.test.tsx`
- `tests/components/selectPortalBoundary.test.ts`
- `tests/components/providerVideoCapabilityEditor.test.ts`
- `tests/components/videoParamSelectorProtocol.test.ts`
- `tests/components/presetNodeWorkflow.test.ts`
- `tests/components/modelProtocolTestRun.test.ts`
- `tests/components/mcpControlSettings.test.ts`：实际回归发现依赖原生标签及事件对象，同步调整控件定位和传值，保留 Store 保存断言。
- `tests/components/select.test.tsx`：新增必要的公共交互验证及原生控件残留扫描。
- 本目录 `task_plan.md`、`findings.md`、`progress.md`。

## 执行批次

1. 盘点与确认范围：完成。
2. 共享控件与演示：完成。
3. 角色、工作流、设置：完成。
4. 节点、预设、视频编辑器：完成。
5. 全面检查及验收：完成。

## 不变项、风险与回滚

- 选项值、默认值、空值含义、数字转换、禁用条件、必填条件和提交回调保持原语义。
- 保留现有编辑开始/结束事件，避免视频编辑历史发生变化。
- 不增加依赖，不更改 Store、模型执行协议或原生权限配置，不修改 README。
- 复用现有 UI Kit token 与尺寸参数；避免通过全局 CSS 替换影响无关控件。
- Portal 风险：父弹窗的外部点击识别、滚动遮挡与焦点恢复；逐个检查宿主事件。
- 原 `.gitignore` 与 `src-tauri/Cargo.toml` 改动保持不动。
- 按批次保留差异，回滚时仅撤销本清单中本次产生的修改；不回滚用户的其他工作。

## 验收

- AST 扫描仅在共享 Select 内发现原生 select。
- 选项文本、分组、禁用、默认与显式空值保留。
- 类型检查、定向 ESLint、相关组件与服务测试、UTF-8 及差异检查通过。
- 检查长列表、屏幕边缘、表单必填、自动聚焦、编辑结束及明暗主题。
- 桌面实机未验证的部分明确记录，不以单元检查代替真实视觉验收。

## 完成结论

- 69 处业务下拉全部复用 UI Kit；演示改为共享组件。AST 扫描确认原生 select 仅保留于共享组件内部。
- 26 个业务文件的 option 子树与修改前逐一比对一致；保留参数值、默认选项、分组和禁用条件。
- 所有本次迁移的控件使用 body Portal，按祖先层级计算菜单层级，并通过视口约束避免裁剪或越界。
- 自动聚焦、必填校验、数字值、键盘导航、焦点恢复和节点/图层编辑器快捷键边界已覆盖。
- 应用类型检查、测试类型检查、修改文件 ESLint、77 个组件测试文件的 570 项测试、严格 UTF-8、差异检查和临时目录生产构建通过。
- 隔离浏览器使用真实 Select 与真实 UI Kit 样式，验证了明暗主题、overflow:hidden、层级 10000、长列表、键盘末项导航、Escape 与必填提交。未逐一操作真实项目的全部 26 个业务界面，未调用模型或修改用户项目数据。

- 后续宽度优化完成：Portal 菜单按内容固有宽度展开，不与触发器等宽；最大宽度限制为视口减去两侧留白。UI Kit 增加窄按钮长选项示例。
