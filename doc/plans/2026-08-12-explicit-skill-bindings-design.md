# 显式 Skill 确定性绑定设计

## 目标

用户在对话输入框选择 Skill 后，该 Skill 必须在 AgentTask 创建时直接成为任务上下文的一部分，不依赖模型再次调用 `skill_load`，并且在任务排队、审批等待、继续和应用重启后保持同一份内容与工具上限。

## 方案

采用任务级不可变 Skill 快照。输入框继续使用既有 `@skill{id|name}` 芯片协议，避免修改主窗口/独立窗口消息同步；`conversationExecutionController` 在创建 AgentTask 前一次性解析显式引用，捕获经过 frontmatter 去除、单 Skill 12,000 字符和合计 24,000 字符限制的正文，以及名称、版本和 Manifest `allowed-tools`。快照写入 `AgentTask.skillBindings`，因此任务运行期间不再依赖全局 `userSkills` 当前状态。

任务上下文由 `expandSkillBindings()` 从快照确定性组装。每个 Skill 都带明确的不可信边界，不能改变目标、Agent 模式、Policy、确认策略或工具权限。Manifest 工具声明在捕获时形成任务级 allowlist，仍然只能缩小 Tool Registry；主动发现的 `skill_load` 保持原状，但不会用于已显式绑定的 Skill。

旧 AgentTask 没有 `skillBindings` 时，继续使用既有 `expandSkillReferences()` 兼容路径；新任务即使之后删除或替换上传 Skill，也继续使用创建时快照。任务时间线显示“已注入 Skill”名称，给用户提供可验证反馈，但不展示或重复持久化完整正文。

## 取舍与边界

- 相比消息元数据方案，不改 `ChatMessageRecord`、项目归档和多窗口协议。
- 相比运行时按 skillId 读取，任务可重放、可恢复，不受 Skill 删除或更新影响。
- 每个任务最多绑定 4 个 Skill，与自主加载上限一致；正文总量仍限制为 24,000 字符。
- 不新增依赖、不提升 IndexedDB schema、不修改 Tauri 权限。

## 回滚

先恢复对话执行链到 `expandSkillReferences()`，再移除任务时间线标识和可选 `skillBindings` 字段。旧数据库可自然忽略可选字段，无迁移或数据清理。
