# Project Memory Backend Boundary Implementation Plan

> 执行说明：按任务顺序实施，每项完成后运行对应定向检查。

**Goal:** 在不改变现有项目记忆行为的前提下抽取持久化 Repository，并验证与 TencentDB Agent Memory v3 L1 Atomic 的安全无损映射。

**Architecture:** `projectMemoryService` 保留公开 API、脱敏和排序；底层依赖可注入的 `ProjectMemoryRepository`，默认实现继续使用 IndexedDB。TencentDB 第一阶段仅提供无网络的 v3 请求/响应映射，真实传输与密钥配置留到独立安全阶段。

**Tech Stack:** TypeScript、Zustand、IndexedDB、Vitest；TencentDB Agent Memory v3 contract（无新增 npm 依赖）。

---

### Task 1: Repository 契约

**Files:**
- Create: `src/services/chat/projectMemoryRepository.ts`
- Create: `src/services/chat/indexedDbProjectMemoryRepository.ts`
- Modify: `src/services/chat/projectMemoryService.ts`
- Create: `tests/services/chat/projectMemoryRepository.test.ts`

**Steps:**
1. 写失败测试，使用 fake repository 验证 service 的保存、排序、删除、项目改挂和来源失效委托。
2. 定义六项操作的 `ProjectMemoryRepository` 接口和 `createProjectMemoryService(repository)`。
3. 把现有 IndexedDB 调用原样迁入默认 repository，保持模块顶层公开函数不变。
4. 运行 `npx vitest run tests/services/chat/projectMemoryRepository.test.ts tests/store/projectSeries.test.ts`。

### Task 2: TencentDB v3 L1 映射

**Files:**
- Create: `src/services/chat/tencentAgentMemoryAdapter.ts`
- Create: `tests/services/chat/tencentAgentMemoryAdapter.test.ts`

**Steps:**
1. 写失败测试，断言 strict isolation、`task_id=projectId`、Atomic ID/正文和版本化 background。
2. 写失败测试，断言合法 Atomic 无损恢复，非法 schema、跨项目、空正文和超限正文 fail-closed。
3. 实现不含 endpoint/apiKey 的纯数据类型与双向映射。
4. 运行 `npx vitest run tests/services/chat/tencentAgentMemoryAdapter.test.ts`。

### Task 3: 文档、验证与提交

**Files:**
- Modify: `doc/对话助手-Agent能力实施方案.md`
- Create: `doc/adr/0006-project-memory-backend-boundary.md`

**Steps:**
1. 更新 8.23 阶段状态、TencentDB 验证基线、未来安全门槛和回滚说明。
2. 运行定向与全量 Vitest、`npm run typecheck`、`npm run test:typecheck`、定向 ESLint和临时目录生产构建。
3. 运行 `git diff --check`、严格 UTF-8 解码和常见乱码扫描。
4. 记录全仓检查结果，提交 `refactor(memory): 建立项目记忆后端适配边界`。
