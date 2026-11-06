/** 外部助手可写入 Three.js 预演数据或分别调用 Blender MCP；此域不执行外部代码。 */
import { useAppStore } from '../../../store/useAppStore';
import type { DirectorOperationOwner, DirectorSceneSource } from '../../../types/directorOperation';
import type { DirectorRuntimeKind } from '../../../types/directorScene';
import {
  cancelDirectorOperation,
  DirectorOperationError,
  getDirectorNodeState,
  getDirectorOperation,
  setDirectorNodeRuntime,
  startDirectorNodeOperation,
} from '../../directorNodeOperationService';
import { parseDirectorPrevisJson, PREVIS_MAX_BYTES } from '../../directorPrevisSchema';
import {
  buildPrevisGenerationPrompt, loadDirectorPrevisScene, saveDirectorPrevisScene,
} from '../../directorPrevisService';
import { validateAgentToolInput, type AgentToolSchema } from '../agentToolSchemas';
import {
  registerAgentTool,
  type AgentToolContext,
  type AgentToolDefinition,
  type AgentToolExecutionResult,
} from '../toolRegistry';

interface NodeInput { nodeId: string }
interface OperationInput { operationId: string }

const idSchema: AgentToolSchema = { type: 'string', minLength: 1, maxLength: 160 };
const nodeSchema: AgentToolSchema = {
  type: 'object', properties: { nodeId: idSchema }, required: ['nodeId'], additionalProperties: false,
};
const operationSchema: AgentToolSchema = {
  type: 'object', properties: { operationId: idSchema }, required: ['operationId'], additionalProperties: false,
};
const previsErrors: Partial<Record<DirectorOperationError['code'], string>> = {
  DIRECTOR_CONTEXT_CHANGED: '画布或预演场景已变化，请重新读取导演台后再操作',
  DIRECTOR_RUNTIME_REQUIRED: '请先用 director_set_runtime 将导演台切换为 ai-threejs',
  DIRECTOR_INVALID_INPUT: '预演场景参数无效，请按 director_get_previs_schema 返回的合同生成完整 JSON',
  DIRECTOR_CANCELLED: '已取消镜头预演操作',
  DIRECTOR_OPERATION_FAILED: '镜头预演读写失败，请检查桌面项目存储；上一场景保留',
};

function requirePrevisNode(nodeId: string) {
  const node = useAppStore.getState().nodes.find((item) => item.id === nodeId && item.type === 'ai-director');
  if (!node) throw new DirectorOperationError('DIRECTOR_NOT_FOUND');
  if (node.data.directorRuntimeKind !== 'ai-threejs') throw new DirectorOperationError('DIRECTOR_RUNTIME_REQUIRED');
  return node;
}

function isMcpContext(context: Pick<AgentToolContext, 'projectId' | 'conversationId'>): boolean {
  return !!context.projectId && context.conversationId === `mcp-control-${context.projectId}`;
}

function owner(context: AgentToolContext): DirectorOperationOwner {
  return { source: 'mcp', projectId: context.projectId, conversationId: context.conversationId, taskId: context.taskId };
}

function success(summary: string, data: unknown): AgentToolExecutionResult {
  return { status: 'success', summary, modelContent: JSON.stringify(data) };
}

function register<T>(definition: AgentToolDefinition<T>, errors?: typeof previsErrors): () => void {
  const authorize: NonNullable<AgentToolDefinition<T>['authorize']> = (context) => ({
    allowed: isMcpContext(context) && useAppStore.getState().currentProjectId === context.projectId
      && (definition.effect === 'read' || context.baseRevision === useAppStore.getState().getCurrentRevision()),
    reason: '导演工具只对当前项目的 MCP 控制会话开放；画布变更后请重新读取状态',
  });
  return registerAgentTool({
    ...definition,
    isAvailable: isMcpContext,
    authorize,
    execute: async (context, input) => {
      try {
        if (!authorize(context, input).allowed) throw new DirectorOperationError('DIRECTOR_CONTEXT_CHANGED');
        if (!validateAgentToolInput(definition.inputSchema, input).valid) {
          throw new DirectorOperationError('DIRECTOR_INVALID_INPUT');
        }
        if (context.signal.aborted) throw new DirectorOperationError('DIRECTOR_CANCELLED');
        return await definition.execute(context, input);
      } catch (error) {
        const code = error instanceof DirectorOperationError ? error.code
          : errors && error instanceof DOMException && error.name === 'AbortError'
            ? context.signal.aborted ? 'DIRECTOR_CANCELLED' : 'DIRECTOR_CONTEXT_CHANGED'
            : 'DIRECTOR_OPERATION_FAILED';
        const failure = new DirectorOperationError(code);
        const message = errors?.[code] ?? failure.message;
        return {
          status: 'error', summary: message, errorCode: failure.code, retryable: false,
          modelContent: JSON.stringify({ error: { code: failure.code, message } }),
        };
      }
    },
  });
}

export function registerDirectorAgentTools(): Array<() => void> {
  return [
    register<NodeInput>({
      id: 'director_get_state', title: '读取导演台状态', effect: 'read', inputSchema: nodeSchema,
      description: '读取一个导演节点的运行时、场景身份、当前任务和成果摘要，不打开 Blender，不返回文件路径。双 MCP 协作时，通过 Blender MCP 核对同一 jobId、sceneId、revision 和摘要后才编辑。',
      execute: async (context, input) => success('已读取导演台状态', { director: await getDirectorNodeState(input.nodeId, owner(context)) }),
    }),
    register<NodeInput & { runtimeKind: DirectorRuntimeKind }>({
      id: 'director_set_runtime', title: '选择导演运行时', effect: 'canvas_write',
      inputSchema: {
        ...nodeSchema, required: ['nodeId', 'runtimeKind'],
        properties: { nodeId: idSchema, runtimeKind: { type: 'string', enum: ['lightweight-web', 'blender', 'ai-threejs'] } },
      },
      description: '为导演节点选择轻量导演台（lightweight-web）、Blender（blender）或 Three.js 镜头预演（ai-threejs）；已有任务时拒绝切换。只更新画布选择，不安装或启动程序。',
      execute: async (context, input) => {
        setDirectorNodeRuntime(input.nodeId, input.runtimeKind, owner(context), context.baseRevision);
        return success('已选择导演运行时', { nodeId: input.nodeId, runtimeKind: input.runtimeKind });
      },
    }),
    register<Record<string, never>>({
      id: 'director_get_previs_schema', title: '读取 Three.js 镜头预演格式', effect: 'read',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      description: '读取 threejs / Three.js 电影运镜、空间简模与人物走位预演的 JSON 合同、完整示例和写入步骤。外部大模型直接生成场景数据，不必调用应用内模型，也不提交 JavaScript、网页、URL 或文件路径。',
      execute: async () => success('已读取镜头预演格式', {
        runtimeKind: 'ai-threejs', schemaVersion: 1, maxBytes: PREVIS_MAX_BYTES,
        instructions: buildPrevisGenerationPrompt('根据用户要求生成电影镜头预演。'),
        steps: [
          '用 canvas_query 查找 ai-director；没有时用 canvas_create_nodes 创建，取得实际 nodeId。',
          '用 director_set_runtime 将该 nodeId 的 runtimeKind 设为 ai-threejs。',
          '修改已有预演前用 director_get_previs_scene 读取当前场景；否则根据合同生成新场景。',
          '用 director_set_previs_scene 提交 nodeId 和完整 sceneJson 字符串。用户双击导演台即可播放和调整。',
        ],
      }),
    }, previsErrors),
    register<NodeInput>({
      id: 'director_get_previs_scene', title: '读取 Three.js 镜头预演场景', effect: 'read', inputSchema: nodeSchema,
      description: '读取 ai-threejs 导演节点已保存的完整场景 JSON，供大模型调整电影运镜、空间简模、人物走位与摄影机关键帧。未保存返回 scene=null；不会把默认示例当作已保存场景，不返回文件路径。',
      execute: async (context, input) => {
        const node = requirePrevisNode(input.nodeId);
        const scene = node.data.directorPrevisScene
          ? await loadDirectorPrevisScene(context.projectId, node.data.directorPrevisScene) : null;
        if (context.signal.aborted) throw new DirectorOperationError('DIRECTOR_CANCELLED');
        if (useAppStore.getState().currentProjectId !== context.projectId
          || requirePrevisNode(input.nodeId).data !== node.data) {
          throw new DirectorOperationError('DIRECTOR_CONTEXT_CHANGED');
        }
        const result = success(scene ? '已读取镜头预演场景' : '导演台尚未保存镜头预演', {
          nodeId: input.nodeId, runtimeKind: 'ai-threejs', scene,
        });
        // MCP reads keep the complete bounded JSON outside the model-result truncation and audit.
        return { ...result, modelContent: result.summary, mcpContent: [{ type: 'text', text: result.modelContent }] };
      },
    }, previsErrors),
    register<NodeInput & { sceneJson: string }>({
      id: 'director_set_previs_scene', title: '写入 Three.js 镜头预演', effect: 'canvas_write',
      inputSchema: {
        ...nodeSchema, required: ['nodeId', 'sceneJson'],
        properties: { nodeId: idSchema, sceneJson: {
          type: 'string', minLength: 1, maxLength: PREVIS_MAX_BYTES,
          description: '按 director_get_previs_schema 合同生成的完整场景 JSON 字符串，UTF-8 最多 512 KiB；不是 JS 或 HTML。',
        } },
      },
      description: '把 MCP 大模型直接生成的 threejs / Three.js 镜头预演放入指定 ai-director 节点。先读取 director_get_previs_schema，再以 director_set_runtime 选择 ai-threejs。支持空间简模、人物走位、position/target/焦距/横滚关键帧，片长 1–60 秒。校验后保存到项目，支持撤销和重开；不执行任意代码，不调用付费模型，不自动生成图片或视频。写入失败不自动重试。',
      summarizeInput: () => '写入已校验的镜头预演场景；原始 JSON 不进入审计摘要',
      execute: async (context, input) => {
        requirePrevisNode(input.nodeId);
        let scene;
        try { scene = parseDirectorPrevisJson(input.sceneJson); }
        catch { throw new DirectorOperationError('DIRECTOR_INVALID_INPUT'); }
        const saved = await saveDirectorPrevisScene(input.nodeId, scene, context.signal);
        return success('镜头预演已保存到导演台，可双击节点播放和调整', {
          nodeId: input.nodeId, runtimeKind: 'ai-threejs', title: saved.title,
          duration: saved.duration, aspectRatio: saved.aspectRatio,
          objectCount: saved.objects.length, cameraKeyframeCount: saved.camera.keyframes.length,
        });
      },
    }, previsErrors),
    ...([
      { id: 'director_open_blender', operation: 'open-editor', title: '打开 Blender 导演台', effect: 'file_write',
        description: '启动受管 Blender 编辑会话并返回 operationId，然后可用独立的 Blender MCP 搭建场景和动画。get_state 返回 supportsSavedScene=true 且已有成果时，默认保留保存工程的时间线、FPS、相机和当前帧；旧后端继续原有导演镜头表模式，明确请求 saved-blender 时返回升级要求。sceneSource=director-scene 明确重用导演镜头表。使用 Blender driver_namespace 中 ai_canvas_director_editor_session_v1 的 jobId、sceneId、sceneRevision、sceneSha256 核对当前任务，只读取这些身份字段。保存返回调用已有 ai_canvas.save_and_return，再查询完成状态；无安装时返回 setup-required。' },
      { id: 'director_render_frame', operation: 'render-frame', title: '导出 Blender 当前帧', effect: 'media_generation',
        description: '启动本地单帧渲染并返回 operationId，完成后图片回填。后端 supportsSavedScene=true 且已有成果时，默认使用保存的 Blender 工程，frame 缺省为保存时当前帧；否则沿用导演镜头表及其起始帧，也可明确 sceneSource=director-scene。明确 saved-blender 而后端不支持或没有成果时拒绝，编辑会话需先保存返回。目标帧必须位于所选来源的实际时间线内。不调用付费 AI 模型。' },
      { id: 'director_render_video', operation: 'render-video', title: '导出 Blender 参考视频', effect: 'media_generation',
        description: '启动本地视频渲染并返回 operationId，完成后回填导演台并创建视频节点。后端 supportsSavedScene=true 且已有成果时，默认保留保存的 Blender 工程起止帧、有效 FPS、活动相机及相机切换标记；否则沿用导演镜头表，也可明确 sceneSource=director-scene。明确 saved-blender 而后端不支持时返回升级要求。保存工程模式最多 14400 帧且最长 600 秒；结果提供实际时间线摘要。编辑会话需先保存返回。不调用付费 AI 模型。' },
    ] as const).map(({ id, operation, title, effect, description }) => register<NodeInput & { frame?: number; sceneSource?: DirectorSceneSource }>({
      id, title, effect, description,
      inputSchema: {
        ...nodeSchema,
        properties: {
          nodeId: idSchema,
          sceneSource: { type: 'string', enum: ['director-scene', 'saved-blender'] },
          ...(operation === 'render-frame' ? { frame: { type: 'integer', minimum: 0, maximum: 10_000_000 } as AgentToolSchema } : {}),
        },
      },
      execute: async (context, input) => {
        const snapshot = await startDirectorNodeOperation({ nodeId: input.nodeId, operation, frame: input.frame, sceneSource: input.sceneSource }, owner(context), {
          baseRevision: context.baseRevision, signal: context.signal,
        });
        return success(snapshot.state === 'succeeded' ? 'Blender 操作已完成并回传'
          : 'Blender 任务已受理，可继续调用 Blender MCP；请通过 director_get_operation 查询实际完成状态', { operation: snapshot });
      },
    })),
    register<OperationInput>({
      id: 'director_get_operation', title: '查询 Blender 任务', effect: 'read', inputSchema: operationSchema,
      description: '按 operationId 只读查询 Blender 任务、进度、jobId、场景身份和已回传的节点 ID。查询不收集文件也不写画布；只有 succeeded 才表示成果已验证并回传。记录仅在本次应用运行期间有效。',
      execute: async (context, input) => success('已读取 Blender 任务', { operation: getDirectorOperation(input.operationId, owner(context)) }),
    }),
    register<OperationInput>({
      id: 'director_cancel_operation', title: '取消 Blender 任务', effect: 'canvas_write', inputSchema: operationSchema,
      description: '取消所属导演台的受管 Blender 任务；cancelling 表示已请求取消，需要继续查询终态。不会关闭其他 Blender 进程。',
      execute: async (context, input) => success('已处理 Blender 取消请求', { operation: cancelDirectorOperation(input.operationId, owner(context)) }),
    }),
  ];
}
