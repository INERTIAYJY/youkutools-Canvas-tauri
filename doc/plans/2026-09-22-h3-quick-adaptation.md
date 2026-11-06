# MiniMax H3 参数模板与自定义接口快速适配

## 目标

把 MiniMax H3 / H3-Max 的模型能力与各平台传输协议分层，让设置页、自定义接口、对话助手和 MCP 共用同一套模板；RunningHub 和 AutoDL 继续使用各自的标准模型/工作流适配器。

## 已确认边界

- H3：768P/2K、4–15 秒；H3-Max：480P/768P、5–15 秒。
- 普通生成支持文生、首尾帧和多模态参考；首尾帧与普通参考素材互斥。最多 9 图、3 视频、3 音频，参考视频和音频单段及总时长按官方约束校验。
- MiniMax 官方与 AI Ping 使用 `content` 多模态数组，但路径不同；APIMart 使用扁平请求字段和自身任务查询协议。
- Context-IR 返回提示词文本，Regeneration 需要源任务或源视频，不作为普通视频生成模板；APIMart 新目录与默认模型选择器不再展示这两个特殊操作，底层旧配置兼容代码暂时保留。
- AI派与 MetaSo 的 OpenAI Videos 兼容接口需要任务成功后二次请求二进制 `/content`。当前声明式协议没有该交付阶段，本批不做不完整适配。

## 实施任务

1. 新建 `h3ModelCapabilities.ts`，集中维护 H3/H3-Max 能力和 MiniMax、APIMart、AI Ping 三套传输模板。
2. 设置页自动识别普通 H3 模型；未知网关只补能力，已验证网关才补协议，已有手工配置不覆盖。
3. 视频能力编辑器增加 H3 快速适配；应用模板时同时写入能力与提交/轮询协议。
4. `provider_config_preview` 暴露 H3 `templateId`，继续复用既有草稿、Policy、审批和 MCP 审计链。
5. APIMart 隐藏 Context-IR、Regeneration 的新接入入口，保留既有用户配置运行兼容。

## 验证入口

- `tests/services/h3ModelCapabilities.test.ts`
- `tests/services/chat/providerConfigDraftService.test.ts`
- `tests/services/chat/providerConfigTools.test.ts`
- `tests/services/apimartGen.test.ts`
- `tests/services/providerCatalogService.test.ts`
- `tests/components/defaultModels.test.ts`

## 回滚

移除 H3 模板注册、设置页入口和工具 `templateId` 枚举，并恢复 APIMart 两个特殊操作的目录展示。已保存的普通 H3 配置仍是标准 `videoCapability + executionProfile`，不依赖模板 ID 运行，无需迁移用户数据。

## 资料

- [MiniMax H3 创建任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)
- [MiniMax H3 查询任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)
- [APIMart H3](https://docs.apimart.ai/en/api-reference/videos/minimax-h3/generation)
- [AI Ping H3](https://www.aiping.cn/docs/API/VideoAPI/MINIMAX_H3_VIDEO_API_DOC)
- [RunningHub H3](https://pre.runninghub.ai/runninghub-api-doc-en/api-495380675)

## 完成记录（2026-09-22）

- 已完成 H3/H3-Max 公共能力、MiniMax/APIMart/AI Ping 三套协议模板，以及设置页、手动添加、目录同步和助手/MCP 草稿的统一接入。
- APIMart 新目录和默认模型选择器已隐藏 Context-IR、Regeneration；旧配置仍可读取既有底层能力，未迁移或删除用户数据。
- RunningHub、AutoDL/ComfyUI 保持原有专用适配器；AI派、MetaSo 因缺少声明式二次二进制下载阶段未接入。
- 验证：8 个受影响测试文件 175 项通过；全量 Vitest 348 个文件、4440 项通过；应用类型、测试类型、改动文件定向 ESLint 与 `git diff --check` 通过。未使用真实 Key 发起付费生成，也未做桌面端人工视觉验收。
