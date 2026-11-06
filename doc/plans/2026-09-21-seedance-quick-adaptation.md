# Seedance 参数统一与自定义接口快速适配 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 统一 Doubao Seedance 2.0/2.5 的官方能力语义，并让自定义接口可一键套用火山原生或 APIMart 兼容的能力与调用协议模板。

**Architecture:** 以 provider-neutral 的 Seedance 能力模板作为单一事实源，火山直连和 APIMart 在其上应用传输层覆盖。自定义接口只在用户显式选择快速适配模板时写入能力与声明式协议，不按模型名自动猜测；协议仍可在现有编辑器中逐项修改。

**Tech Stack:** React 19、TypeScript 6、Zustand 5、Vitest 4、现有声明式 Model Protocol Runtime。

---

### Task 1: 扩展视频能力语义

**Files:**
- Modify: `src/types/aiTypes.ts`
- Modify: `src/services/ai/videoRequestResolver.ts`
- Test: `tests/services/videoRequestResolver.test.ts`

**Steps:**
1. 先增加失败测试，覆盖 `automaticDurationValue=-1`、视频编辑强制自动时长、首尾帧/视频编辑强制 `adaptive`。
2. 运行 `npx vitest run tests/services/videoRequestResolver.test.ts`，确认新断言失败。
3. 增加自动时长哨兵与 operation/input-mode 参数覆盖类型，并在 canonical resolver 中合并与校验。
4. 重跑定向测试，确认通过。

### Task 2: 建立 Seedance 单一能力源与快速适配模板

**Files:**
- Create: `src/services/ai/seedanceModelCapabilities.ts`
- Modify: `src/services/ai/modelProtocolVariables.ts`
- Modify: `src/services/ai/generateVideo.ts`
- Test: `tests/services/seedanceModelCapabilities.test.ts`
- Test: `tests/services/modelProtocolVariables.test.ts`

**Steps:**
1. 写失败测试，覆盖四个 Seedance 变体、火山/APIMart 两种协议，以及官方 content 数组变量。
2. 实现官方能力工厂、provider 覆盖和协议模板克隆函数。
3. 向通用视频协议注入 `seedanceContent`，支持火山原生 `content` 数组。
4. 验证模板不会根据模型名自动生效，且返回值均为深拷贝。

### Task 3: 迁移内置火山与 APIMart 能力

**Files:**
- Modify: `src/services/ai/volcengineVideoModels.ts`
- Modify: `src/services/ai/apimartVideoModels.ts`
- Modify: `src/services/ai/generateVideo.ts`
- Test: `tests/services/volcengineVideoModels.test.ts`
- Test: `tests/services/apimartGen.test.ts`

**Steps:**
1. 更新测试预期：火山 2.0 支持 `adaptive`；火山 2.5 默认自适应与自动时长；APIMart 保持自身已确认的分辨率/时长子集。
2. 让两个 Provider 从共享能力工厂派生，再叠加字段名、模型 ID 和中转限制。
3. 保留 APIMart 的 `size`、`image_with_roles`、任务响应结构；火山继续使用 `ratio`、`content`。
4. 重跑两组适配器测试。

### Task 4: 参数面板支持自动时长与任务约束

**Files:**
- Modify: `src/components/nodes/shared/VideoParamSelector.tsx`
- Test: `tests/components/videoParamSelectorProtocol.test.ts`

**Steps:**
1. 写失败测试，覆盖 2.5 默认显示“自动”、用户仍可选择 4-30 秒、首尾帧只显示 `adaptive`。
2. 增加自动时长按钮与任务模式下的有效比例计算。
3. 切换模型或参考模式时，把失效的旧值收敛到当前能力默认值。
4. 重跑组件定向测试。

### Task 5: 自定义接口一键应用能力与协议

**Files:**
- Modify: `src/components/settings/providerConnection/VideoCapabilityEditor.tsx`
- Modify: `src/components/settings/providerConnection/ProviderModelSection.tsx`
- Modify: `src/components/settings/providerConnection/providerConnectionModels.ts`
- Test: `tests/components/providerConnectionForm.test.tsx`
- Test: `tests/services/seedanceModelCapabilities.test.ts`

**Steps:**
1. 写失败测试，覆盖显式选择型号与协议后同时写入 `videoCapability` 和 `executionProfile`。
2. 在视频能力编辑器增加“Seedance 快速适配”，提供 2.0/2.0 Fast/2.0 Mini/2.5 与火山原生/APIMart 兼容组合。
3. 应用前展示覆盖提示；应用后仍可打开能力和协议编辑器逐项调整。
4. 不对未选择模板的模型做名称推断或配置迁移。

### Task 6: 文档与完整验证

**Files:**
- Modify: `doc/模型与生成模块.md`

**Steps:**
1. 记录能力层与传输层边界、自定义快速适配的显式选择原则及已知中转限制。
2. 运行改动文件定向 ESLint、相关 Vitest、`npm run typecheck`、`npm run test:typecheck`、`git diff --check`。
3. 使用严格 UTF-8 解码检查全部改动文本并扫描常见乱码字符。
4. 检查 `git status --short`，确保不包含既有 `builtinWorkflows` 改动。

## 实施结果（2026-09-21）

- 状态：已完成。Seedance 2.0/2.5 共用官方能力语义，火山直连与 APIMart 保留各自传输覆盖；自定义接口支持显式选择八组“型号 + 协议”快速模板。
- 参数行为：火山 Seedance 2.5 默认提交自动时长 `-1`；首尾帧模式只展示 `adaptive`，视频编辑同时强制 `adaptive` 与自动时长。旧值在模型或参考模式切换后会收敛到当前有效默认值。
- 安全边界：快速适配只由用户手动应用，不按模型名称推断；未知复合 `content` 文档继续走原有人工确认逻辑，未扩大自动导入范围。
- 验证：`npm run typecheck`、`npm run test:typecheck`、改动文件定向 ESLint、`git diff --check` 均通过；全量 `npm run test` 为 344 个文件、4391 项通过。
- 未覆盖：未使用真实火山/APIMart Key 发起付费生成，也未做桌面端人工视觉验收；协议字段与能力边界由本地合同测试覆盖。

## 第二阶段：自定义接口自动匹配与工具调用（2026-09-22）

**Goal:** 在不覆盖用户已有手工配置的前提下，根据 Seedance 模型 ID 与已验证网关自动补齐能力和协议，并让设置页、对话助手与 MCP 复用同一模板解析器。

**Architecture:** 继续把模型能力与平台传输分层。匹配顺序固定为“精确模型 ID 覆盖 → 已验证 Base URL 平台协议 → Seedance 家族能力”；未知平台只补能力，不猜请求协议。对话助手和 MCP 继续调用现有 `provider_config_preview` / `provider_config_apply` 工具链，模板只负责生成受本地校验约束的草稿，不绕过 `config_write` Policy、审批或 MCP 审计。

### Task 7: 扩展共享模板解析器

**Files:**
- Modify: `src/services/ai/seedanceModelCapabilities.ts`
- Test: `tests/services/seedanceModelCapabilities.test.ts`

**Steps:**
1. 增加失败测试，覆盖 Seedance 2.0/2.5、Fast/Mini 名称归一化、已知网关识别、未知平台只返回能力。
2. 增加 Lec `/v1/videos` 异步协议和已核验模型 ID 的线路能力覆盖。
3. 提供“只补空白”的单模型与模型列表应用函数，保证已有 `videoCapability`、`executionProfile` 和手工分类不被覆盖。
4. 重跑模板定向测试。

### Task 8: 设置页自动补齐

**Files:**
- Modify: `src/components/settings/ProviderConnectionDialog.tsx`

**Steps:**
1. 手动添加或拉取目录后，对识别到的 Seedance 模型调用共享模板解析器。
2. 模型 ID 明确属于 Seedance 时自动归类为视频；已有手工分类保持不变。
3. 已有能力或协议只保留，不因重新拉取模型或修改 Base URL 被静默覆盖。

### Task 9: 对话助手与 MCP 调用模板

**Files:**
- Modify: `src/services/chat/providerConfigDraftService.ts`
- Modify: `src/services/chat/tools/providerConfigTools.ts`
- Test: `tests/services/chat/providerConfigDraftService.test.ts`
- Test: `tests/services/chat/providerConfigTools.test.ts`

**Steps:**
1. 给 `provider_config_preview` 的模型输入增加可选 `templateId`，并允许已识别的 Seedance 模型按 Base URL 自动选择模板。
2. 显式文档示例、声明式协议和能力始终优先；模板只填缺失字段。
3. 模板仍生成任务级草稿，由既有 `provider_config_apply` 保存；普通助手保留确认，MCP 继续按现有 C 模式自动执行并记录审计任务。
4. 增加 schema、草稿、合并与“不覆盖已有配置”测试。

### Task 10: 验证与记录

**Files:**
- Modify: `doc/模型与生成模块.md`（仅在不覆盖当前 ComfyUI 在途改动的独立段落追加边界说明）

**Steps:**
1. 运行 Seedance、厂商配置工具与协议定向测试。
2. 运行改动文件 ESLint、`npm run typecheck`、`npm run test:typecheck` 和 `git diff --check`。
3. 严格 UTF-8 解码改动文件并扫描常见乱码；检查提交仅包含本阶段文件。

**Rollback:** 移除自动匹配调用和工具 `templateId` 输入，保留第一阶段的显式快速适配模板；已保存的模型配置仍是普通 `videoCapability + executionProfile` 数据，不依赖模板 ID 运行，无需迁移或回滚用户数据。

### 第二阶段完成记录（2026-09-22）

- 已完成：设置页在打开连接、拉取模型目录和手动添加模型时自动识别 Seedance 2.0/2.5；已验证火山、APIMart、Lec 网关补齐协议，未知网关只补能力，已有手工字段保持优先。
- 已完成：`provider_config_preview` 支持自动匹配及显式 `templateId`，生成的草稿继续由 `provider_config_apply` 写入，因此普通助手确认、MCP 自主模式和审计边界保持不变。
- 验证：Seedance、Provider 草稿和 Provider 工具 3 个定向测试文件共 86 项通过；`npm run typecheck`、`npm run test:typecheck`、改动文件定向 ESLint、`git diff --check` 与 9 个文件严格 UTF-8 检查通过。
- 未覆盖：未使用真实中转站 Key 发起付费视频任务；Ailingg、RealmRouter、Agnes、AI派缺少足够公开合同的网关不自动套用传输协议。
