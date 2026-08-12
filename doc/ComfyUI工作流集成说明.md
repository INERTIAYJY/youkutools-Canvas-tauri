# ComfyUI 工作流集成说明

> 本文档描述 AI Canvas 如何导入、管理和执行 ComfyUI 工作流，包括 IO 节点识别、内容与参数注入规则、结果取回和编辑回写链路。
> 当前版本：`0.8.2`；最后更新：2026-08-12。

## 1. 概览

ComfyUI 在 AI Canvas 里是一种 **provider**：工作流导入后会出现在生成节点的模型下拉里，选中后该次生成的 `provider` 为 `comfyui`、`requestModel` 为 `comfyui/workflow`，并带上 `workflowId`。运行时不解释工作流的语义，只做四件事：

1. 把画布上的提示词、图片、视频、音频**注入**到工作流对应的节点；
2. 把节点面板上选的分辨率、比例、帧率、时长**注入**到工作流的参数节点；
3. 提交到 ComfyUI 的 `/prompt` 并轮询 `/history`；
4. 把产物地址取回来，下载保存进项目目录。

执行路径按分类分三条：

| 分类 | 入口 | 执行函数 |
|------|------|---------|
| `ai-image` | [generateImage.ts:148](../src/services/ai/generateImage.ts:148) | `executeComfyUIGenerate` |
| `ai-video` | [generateVideo.ts:283](../src/services/ai/generateVideo.ts:283) | `executeComfyUIVideoGenerate` |
| `ai-audio` | [generateAudio.ts:132](../src/services/ai/generateAudio.ts:132) | `executeComfyUIAudioGenerate` |

`ai-text` 分类只能导入和归类，**没有执行路径** —— 文本生成不会走 ComfyUI。

## 2. 配置与连接

设置 → ComfyUI 里有两项：

- **服务地址**：默认 `http://127.0.0.1:8188`，存在 `config.comfyUIUrl`。未配置时执行会直接抛「未配置 ComfyUI 服务地址」。
- **本地安装目录**：存在 `config.comfyUIPath`，配好后可以一键启动本地 ComfyUI（Tauri 命令 `launch_comfyui`，启动参数固定为 `-u -s main.py --listen --enable-cors-header`）。

所有请求都经过 [comfyWorkflowService.ts](../src/services/comfyWorkflowService.ts) 里的 `comfyFetch`，出口按环境分流：

- **Tauri 桌面**：走 `corsSafeFetch` → Rust `proxy_fetch`，不受浏览器同源限制；
- **浏览器开发模式**：`http://127.0.0.1:<port>` 会被替换成 Vite 代理路径 `/api/comfyui`。

## 3. 数据模型

工作流定义见 [types/index.ts:577](../src/types/index.ts:577)：

| 字段 | 说明 |
|------|------|
| `id` | 手动导入是 `wf-<随机>`，内置工作流是固定的 `builtin-*` |
| `category` | `ai-text` / `ai-image` / `ai-video` / `ai-audio` |
| `fileName` | 原始文件名，列表里显示用 |
| `fileContent` | **API 格式** JSON 字符串，执行时解析的就是它 |
| `editableContent` | **界面格式** JSON，只用于在 ComfyUI 里打开时保住节点布局 |
| `ioNodes` | 识别出的输入/输出节点，`{ nodeId, title, type }` |
| `defaultNodes` | 各类型的默认 IO 节点，`type → nodeId` |

两种 JSON 格式不能混用：

- **API 格式**（ComfyUI 里「导出 (API)」）形如 `{ "105:104": { class_type, inputs, _meta } }`，是提交给 `/prompt` 的格式；
- **界面格式**（「导出」）形如 `{ nodes: [...], links: [...] }`，带坐标和连线，只有它能在 ComfyUI 画布里还原布局。

两者都有 16 MiB 上限，前端 `validateSavePayload` 和 Rust `parse_workflow_save_payload` 各校验一次。

状态存在 [store.workflows.ts](../src/store/store.workflows.ts) 的 `workflows` 里，增删改都同步落 `fileService.saveWorkflow`（IndexedDB）。

## 4. 工作流从哪来

### 4.1 手动导入

工作流管理面板（设置 → ComfyUI → 管理工作流，或画布右键菜单）选 `.json` 文件，解析成功后即时识别 IO 节点并预览。**必须是 API 格式**，导入界面格式的文件会因为识别不到 `class_type` 而一个 IO 节点都认不出来。

### 4.2 内置工作流播种

[builtinWorkflows.ts](../src/services/builtinWorkflows.ts) 内置了 6 个 MiniMax H3 视频工作流（文生/图生/参考生 × 普通/Turbo），JSON 打包在 `src/assets/comfyWorkflows/` 下，界面格式放在同级 `ui/` 里。

播种按 id **逐个记账**在 `localStorage` 的 `aicanvas.builtinWorkflows.seededIds`：

- 中途出错的那一批下次启动会重来；
- 用户删掉的不会自己长回来；
- 后续版本新增的会在下次启动自动补上。

### 4.3 从 ComfyUI 编辑后保存回来

见 [§9](#9-comfyui-编辑窗口与回写)。

## 5. IO 节点识别

`extractComfyUIIONodes`（[comfyUIWindowService.ts:59](../src/services/comfyUIWindowService.ts:59)）扫一遍 API JSON，按 `class_type` 归类：

| 类型 | 匹配的 class_type |
|------|------------------|
| `image` | `LoadImage*` |
| `video` | `LoadVideo*`、`VHS_LoadVideo*`、`VHS_LoadVideoPath*` |
| `audio` | `LoadAudio*`、`VHS_LoadAudio*`、`RecordAudio*` |
| `prompt` | `CLIPTextEncode`、`*TextEncode`、`StringLiteral`、`PrimitiveString`、`ShowText`/`pysssss` |

类型规则没命中时还有一层兜底：节点的 `inputs` 里只要有名字含 `text` / `prompt` / `writing` 且值是非空字符串的输入，就算作 `prompt` 类型。`showAnything`、`PreviewAny`、`DisplayText` 这类展示节点排除在外 —— 它们的 `text` 是给人看的结果，不是提示词入口。

识别结果只是**候选清单**，用来在提示词框里 `@` 和在面板上标默认节点，不影响参数注入。

## 6. 默认节点 defaultNodes

工作流管理面板里点节点徽章可以把它设为该类型的默认节点（徽章变 ★）。语义是：

> 用户**没有** `@` 该类型的任何节点时，提示词框里的同类内容自动送进这个节点。

优先级规则在 `submitComfyUIWorkflow` 里（[comfyWorkflowService.ts:910](../src/services/comfyWorkflowService.ts:910)）：**某个类型只要被 `@` 过一次，该类型就完全按用户的赋值走，默认节点不再介入。** 类型之间互不影响 —— `@` 了提示词节点，图片的默认节点照常生效。

在 ComfyUI 里改完结构存回来时，指向已不存在节点的默认设置会被 `pruneDefaultNodes` 丢掉。

## 7. 执行链路

以视频为例，`executeComfyUIVideoGenerate` 的完整顺序：

1. **预存待续任务** —— 在提交之前就写 `savePendingTask`，保证关窗重启后能恢复（`submitted: false`）；
2. **解析工作流** —— 从 store 取 `fileContent` 并 `JSON.parse`，得到可改的 `workflowObj`；
3. **注入提示词** → `injectPromptsIntoWorkflow`；
4. **注入图片** → `injectImagesIntoWorkflow`（上传后写文件名）；
5. **注入默认媒体** → `injectDefaultMediaIntoWorkflow`（图片/视频）；
6. **注入音频** → `injectAudioIntoWorkflow`；
7. **查节点声明** → `resolveVideoParamSpecs`，只为需要校验的字段问 `/object_info/{class}`；
8. **注入视频参数** → `injectVideoParamsIntoWorkflow`；
9. **提交** → `POST /prompt`，拿到 `prompt_id` 后回填待续任务（`submitted: true`）；
10. **轮询** → `/history/{promptId}`，取到产物地址后返回；
11. 上层把产物下载保存进项目目录，写回节点。

注意 `submitComfyUIWorkflow` 这个名字有点误导：它只负责**构建** `workflowObj` 并返回，真正提交的是 `promptComfyUIWorkflow`。参数注入夹在这两步之间。

## 8. 注入规则

### 8.1 提示词

`injectPromptsIntoWorkflow` 分三种情况：

| 情况 | 行为 |
|------|------|
| 指定了默认提示词节点，且没 `@` 过提示词节点 | 只写这一个节点，写它第一个存在且是字符串的键（`text` → `prompt` → `string` → `value`） |
| 没有任何 `@` 赋值，也没默认节点 | 兜底猜测：遍历所有 `text`/`prompt` 输入，**只替换看起来像占位符的值**（长度 < 10 且不含空格，例如 `t-1`） |
| 有 `@` 赋值 | 只写被 `@` 命中且在 `ioNodes` 里的节点，其余保持原值 |

### 8.2 图片 / 音频 / 视频

媒体统一先上传到 ComfyUI 的 `/upload/image`（ComfyUI 只有 `/upload/image` 和 `/upload/mask` 两个上传路由，前者不校验扩展名，音频视频同样走它），再把返回的文件名写进节点：

| 类型 | 写入的输入键 |
|------|-------------|
| 图片 | `image`（并同步 `upload` 字段） |
| 视频 | `video`，没有就试 `file`（核心 `LoadVideo` 用的是 `file`） |
| 音频 | `audio`（并同步 `upload` 字段） |

**读主机绝对路径的节点会被跳过**（音频的 `audio_file`、视频里既没有 `video` 也没有 `file` 的变体）—— 上传到 `input` 目录得到的文件名对它们无效，宁可跳过也不写错路径。

`injectDefaultMediaIntoWorkflow` 还会处理 autogrow 可选参考位：ComfyUI 的可选槽形如 `ref_images.ref_image_1`（键名带点号），用户这次带的参考图不够填满时，没轮到的槽会连同下游链路一起摘掉，避免残留的示例文件名让工作流报错。只有整条链路终点全是可选槽才摘，否则一律保留。

### 8.3 图片尺寸

`injectDimensionsIntoWorkflow`：`mapImageDimensions(imageSize, aspectRatio)` 把画质档位当**短边**（`720p`=720 / `1K`=1024 / `2K`=2048 / `4K`=4096）按比例算另一边，然后写进所有 `width`、`height` 都是数字的节点，外加 ResolutionSelector 类节点的 `aspect_ratio` + `megapixels`。

### 8.4 视频参数

`injectVideoParamsIntoWorkflow`（[comfyWorkflowService.ts:820](../src/services/comfyWorkflowService.ts:820)）按**输入名**匹配，不按 IO 节点过滤 —— 分辨率、帧率、帧数都在 latent / 合成节点上，用户不会去 `@` 它们。

认的字段是照着 ComfyUI 核心（`comfy_extras`、`comfy_api_nodes`）和常用插件的节点定义列的：

| 参数 | 输入名 | 典型来源 |
|------|--------|---------|
| 帧数 | `length` | Wan / Hunyuan / Mochi / LTXV 的 latent 节点（要求同节点有数字 `width`/`height`） |
| | `num_frames` | WanVideoWrapper 全家、`WanTrackToVideo` |
| | `video_frames` | `SVD_img2vid_Conditioning` |
| | `frame_count`、`frames` | VHS 等 |
| 帧率 | `fps` | `CreateVideo`、`SaveWEBM`、SVD |
| | `frame_rate` | `LTXVConditioning`、`VHS_VideoCombine` |
| 时长 | `duration`、`duration_seconds` | MiniMax、Kling、Vidu、Pixverse、Sora、Veo 等 API 节点 |
| 尺寸 | `width` + `height` | 任意同时是数字的节点 |
| | `aspect_ratio` + `megapixels` | `ResolutionSelector` |
| | `aspect_ratio`（纯 `16:9`） | API 节点 |
| | `resolution`（`720p` / `1920x1080`） | API 节点 |

几条关键规则：

- **只写数字**。连线过来的值是 `["3", 0]` 这样的数组，跳过 —— 写进去会把连接冲掉。
- **秒数节点优先**。先扫一遍 `PrimitiveFloat` / `PrimitiveInt` 且标题匹配 `duration|时长|秒` 的节点，写秒数。一旦命中，**帧率就不再注入** —— 这类工作流自己按秒算帧，帧率是算式里的常量，再去改它只会让时长对不上。内置的 MiniMax H3 工作流正是这种结构，所以在它们上面调帧率是不生效的。
- **分辨率是长边**。`mapVideoDimensions` 把分辨率数值当长边（和图片的短边语义相反），按比例算另一边并对齐到 8 —— ComfyUI latent 和多数视频模型都要求边长是 8 的倍数。
- **`length` 要同节点有 `width`/`height`** 才写，避免误伤其他节点上同名的 `length` 参数。

刻意**不碰**的字段：

- `LoadVideo` 系列的 `custom_width` / `custom_height` / `force_rate` / `frame_load_cap` —— 那是处理输入素材的参数，写进去会把用户传的视频改掉（按 class_type 整个节点跳过）；
- 裁剪类节点（class_type 含 `slice`/`trim`/`cut`/`crop`）的 `duration` —— 那是截取长度，不是出片时长；
- `target_width` / `final_width` 这类图像拼接工具节点的尺寸参数 —— 语义太杂。

### 8.5 combo 字段的可选值校验

`aspect_ratio`、`resolution`、`duration` 大多是 combo，各节点的可选值都不一样（Kling 只给 `720p`/`1080p`，Vidu 给 `360p`/`540p`/`720p`/`1080p`；时长有的是 `[5, 10]` 有的是 `["5s", "10s"]`）。写一个节点不认识的值，ComfyUI 会判整个任务非法直接拒掉 —— 那比「设置不生效」更糟。

所以这几个字段先问 `GET /object_info/{class_type}`（单节点查询，不是拉几 MB 的全量表）拿到可选值再写：

| 字段 | 挑法 |
|------|------|
| `aspect_ratio` | 找 `16:9` 或 `16:9 (…)` 开头的那一项 |
| `resolution` | 按长边像素挑最接近的一档；`1920x1080` 这种写法还要求朝向一致 |
| `duration` | 挑最接近的可选值（选 9 秒而节点只给 5/10 → 退到 10）；纯数字型的按声明的 `min`/`max` 收边 |

结果按 `baseUrl + class_type` 缓存 30 秒，一个工作流通常只命中一两个节点。**问不到就一律不写**，退回原来的行为 —— ComfyUI 没连上不会导致把任务写崩。

## 9. 结果取回

`/history/{promptId}` 的 `outputs` 结构各节点并不统一，[comfyOutputs.ts](../src/services/comfyOutputs.ts) 两层兜底：

1. **按已知键名**：图片 `images`/`image`，视频 `videos`/`video`/`gifs`，音频 `audio`/`audios`；
2. **按扩展名**：键名认不出时扫描其余键，按 `.mp4`/`.png`/`.mp3` 这类扩展名认领。

找到后拼成 `{baseUrl}/view?filename=…&subfolder=…&type=output`。视频按 `['video', 'image']` 的优先级找 —— `SaveWEBM`/`SaveVideo` 常把成片挂在 `images` 下。

轮询节奏：**3 秒一次，最多 1200 次（1 小时）**。失败信息从 `status.messages` 里倒着找 `exception_message` / `error` / `message`，找不到就报「ComfyUI 执行失败」。执行完成但取不到目标媒体，报「执行完成但未返回目标媒体」。

## 10. 断点续查

`savePendingTask` 在提交**之前**就落盘，`taskId` 留空、`submitted: false`；拿到 `prompt_id` 后再回填。这样关窗重启后 [pollManager.ts](../src/services/pollManager.ts) 的 `resumeComfyUI` 能接着轮询，不会因为「提交了但没记下 id」而丢任务。任务结束（成功或失败）在 `finally` 里清理。

## 11. ComfyUI 编辑窗口与回写

工作流列表里点铅笔图标会开一个独立的 ComfyUI 窗口：

1. **先拦缺节点** —— `findMissingNodeClasses` 拉 `/object_info` 比对 class_type。缺节点时 ComfyUI 会中止加载但照样开一个同名标签页，画布上还留着上一个工作流，看起来就像「打开了别的工作流」，所以宁可提前把缺什么说清楚；
2. **开窗** —— Tauri 命令 `open_comfyui_window`，把 API JSON 和界面 JSON 一起带过去；
3. **注入桥接脚本** —— `bridge.js` **只对 loopback 地址注入**，远程 ComfyUI 不注入；
4. **保存** —— 桥接脚本把两种格式的 JSON 打包放到 `window.__AI_CANVAS_PENDING_SAVE_PAYLOAD__`，Rust 用 `eval_with_callback` 取回来、校验（分类合法、两份 JSON 都能解析、都不超 16 MiB），再 `emit` 出 `comfyui-workflow-save` 事件；
5. **落库** —— 前端 `initComfyUIWindowBridge` 收到事件后再校验一次，已存在就更新（重新识别 IO 节点、剪掉失效的默认节点），不存在就新建。

面板保持打开不关：ComfyUI 那边存回来后列表会实时刷新，方便接着改默认节点。

## 12. 已知限制

- **`ai-text` 分类不能执行** —— 能导入、能分类，但文本生成不走 ComfyUI。
- **`width`/`height` 注入不区分节点用途** —— 工作流里任何同时是数字 `width`/`height` 的节点都会被覆盖成当前尺寸。被 `@` 的都是提示词/图片 IO 节点，按它们过滤等于什么都不注入，所以这里选择了全量覆盖。
- **有秒数节点时帧率不生效**，见 [§8.4](#84-视频参数)。
- **字段名不在表里的工作流不会被注入** —— 比如用 `video_length`、`seconds` 之类自定义命名的节点。
- **浏览器开发模式下**编辑窗口、保存回写、本地启动 ComfyUI 都不可用（依赖 Tauri）。

## 13. 相关文件

| 文件 | 职责 |
|------|------|
| [src/services/comfyWorkflowService.ts](../src/services/comfyWorkflowService.ts) | 执行运行时：注入、上传、提交、轮询 |
| [src/services/comfyOutputs.ts](../src/services/comfyOutputs.ts) | 从 `/history` 输出里认领产物并拼 `/view` 地址 |
| [src/services/comfyUIWindowService.ts](../src/services/comfyUIWindowService.ts) | IO 节点识别、编辑窗口、保存回写 |
| [src/services/builtinWorkflows.ts](../src/services/builtinWorkflows.ts) | 内置工作流播种 |
| [src/services/aiDimensions.ts](../src/services/aiDimensions.ts) | 尺寸/帧数/秒数换算 |
| [src/components/WorkflowPanel.tsx](../src/components/WorkflowPanel.tsx) | 工作流管理面板 |
| [src/store/store.workflows.ts](../src/store/store.workflows.ts) | 工作流 CRUD 与持久化 |
| [src-tauri/src/comfyui/mod.rs](../src-tauri/src/comfyui/mod.rs) | 启动本地 ComfyUI、编辑窗口、保存 payload 校验 |
| [tests/services/comfyVideoParams.test.ts](../tests/services/comfyVideoParams.test.ts) | 视频参数注入的回归用例 |
