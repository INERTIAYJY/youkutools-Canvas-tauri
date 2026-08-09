# xAI / Grok 官方厂商接入设计

## 目标与范围

在现有厂商连接体系中新增独立的 `xAI / Grok 官方` 内置厂商。用户只需填写 xAI API Key，即可从本地清单选择官方文本、图片和视频模型，并继续复用统一模型菜单、声明式协议运行时、任务轮询、结果持久化与凭据存储能力。

首版包含 `grok-4.5` 文本模型，`grok-imagine-image` 与 `grok-imagine-image-quality` 图片模型，以及两个职责明确的视频条目：`grok-imagine-video` 用于文生视频，`grok-imagine-video-1.5` 用于单图生视频。多参考图、视频编辑和视频延长不在本阶段范围内。

## 架构与数据流

xAI 模型及其执行协议集中定义在独立 manifest 中，厂商目录服务只注册连接元数据并引用该清单。设置页把 manifest 合并进现有本地模型目录，保存后仍形成普通 `ApiProviderConfig`，API Key 只经过既有 Rust 凭据存储，不进入模型清单或协议。

带 `executionProfile` 的内置模型会像自定义接口模型一样同步为 `GeneralModelConfig`。文本请求复用 OpenAI Chat Completions 预设；图片请求调用 `/images/generations`；视频请求调用 `/videos/generations`，从 `request_id` 构建 `/videos/{request_id}` 轮询地址，并从 `video.url` 读取结果。轮询默认每 10 秒一次，对 429 和瞬时网关错误执行有限指数退避。

文生视频和单图生视频使用两份协议，避免在没有参考图时发送空 `image` 对象。图生视频协议显式映射 `image.url` 到画布解析后的首张参考图。

## 错误处理与验证

官方任务状态 `failed` 与 `expired` 都作为终止失败处理；临时网络错误、429 和常见 5xx 仅在轮询阶段按固定预算重试。协议保持同源限制，无法把任务查询重定向到其他厂商地址。

验证覆盖厂商定义、本地模型清单、协议 schema、文本/图片请求渲染、视频任务 ID 与轮询路径、Store 同步和连接清理。最后运行定向 Vitest、TypeScript 类型检查、ESLint、`git diff --check` 与严格 UTF-8 检查。
