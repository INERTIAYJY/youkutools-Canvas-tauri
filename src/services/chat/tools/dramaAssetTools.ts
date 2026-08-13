/**
 * 注册短剧资产（人物/场景/道具）与角色库工具：读取让 Agent 先发现已有设定，
 * 再用 @drama{id:name} 引用它们；写入（新增/修改/删除）一律经 Policy 审批后才落库。
 *
 * scope=project 操作当前项目资产库，scope=global 操作跨项目角色库（只有角色）。
 */
import { useAppStore } from '../../../store/useAppStore';
import type { CharacterLibraryScope } from '../../../store/store.dramaAssets';
import type {
  CharacterVoiceKind,
  DramaAsset,
  DramaAssetImportance,
  DramaAssetKind,
  DramaCharacter,
} from '../../../types/dramaAssets';
import { formatDramaMention, normalizeDramaCharacter } from '../../../types/dramaAssets';
import { findDramaAsset, formatDramaAssetTextBrief, listDramaAssetsFlat } from '../../dramaAssetPrompt';
import {
  registerAgentTool,
  type AgentToolExecutionResult,
} from '../toolRegistry';
import type { AgentToolSchema } from '../agentToolSchemas';

const DRAMA_ASSET_KINDS: DramaAssetKind[] = ['character', 'scene', 'prop'];
const DRAMA_ASSET_IMPORTANCES: DramaAssetImportance[] = ['main', 'supporting', 'minor'];
const SCOPES: CharacterLibraryScope[] = ['project', 'global'];
/** 各类资产可写的专属字段；写入时用它拦截跨类型字段。 */
const KIND_FIELDS: Record<DramaAssetKind, string[]> = {
  character: ['identity', 'personality', 'wardrobeDefault', 'voiceNotes'],
  scene: ['placeType', 'timeOfDay', 'atmosphere', 'spatialNotes'],
  prop: ['ownerName', 'category', 'significance'],
};
const SHARED_FIELDS = ['name', 'summary', 'visualNotes', 'storyRole', 'importance'];

function authorizeCurrentProject(context: { projectId: string }) {
  return useAppStore.getState().currentProjectId === context.projectId
    ? { allowed: true }
    : { allowed: false, reason: '目标项目当前未加载，不能读取其他项目的短剧资产' };
}

/** 全局角色库不属于任何项目，只有 project 作用域需要校验当前项目。 */
function authorizeScope(context: { projectId: string }, input: { scope?: CharacterLibraryScope }) {
  return input.scope === 'global' ? { allowed: true } : authorizeCurrentProject(context);
}

function listScopedAssets(scope: CharacterLibraryScope | undefined): DramaAsset[] {
  const store = useAppStore.getState();
  return scope === 'global'
    ? store.globalCharacters
    : listDramaAssetsFlat(store.dramaAssets);
}

function findScopedAsset(
  scope: CharacterLibraryScope | undefined,
  assetId: string,
): DramaAsset | undefined {
  const store = useAppStore.getState();
  return scope === 'global'
    ? store.globalCharacters.find((item) => item.id === assetId)
    : findDramaAsset(store.dramaAssets, assetId);
}

/** 列表条目只给 Agent 挑选所需的信息，完整简报留给 drama_asset_get。 */
function summarizeAsset(asset: DramaAsset) {
  const character = asset.kind === 'character' ? asset as DramaCharacter : undefined;
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    summary: asset.summary || undefined,
    importance: asset.importance,
    mention: formatDramaMention(asset.id, asset.name),
    referenceImageCount: character?.referenceImages?.length ?? (asset.imageUrl ? 1 : 0),
    voiceClipCount: character?.voiceClips?.length ?? 0,
    hasVoice: Boolean(character?.primaryVoiceClipId),
  };
}

const scopeProperty = { type: 'string' as const, enum: [...SCOPES] };

const listInputSchema: AgentToolSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: DRAMA_ASSET_KINDS },
    scope: scopeProperty,
  },
};

const getInputSchema: AgentToolSchema = {
  type: 'object',
  required: ['assetId'],
  additionalProperties: false,
  properties: {
    assetId: { type: 'string', minLength: 1, maxLength: 160 },
    scope: scopeProperty,
  },
};

const textField = { type: 'string' as const, maxLength: 2000 };

const upsertInputSchema: AgentToolSchema = {
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    scope: scopeProperty,
    kind: { type: 'string', enum: DRAMA_ASSET_KINDS },
    assetId: { type: 'string', minLength: 1, maxLength: 160 },
    name: { type: 'string', minLength: 1, maxLength: 60 },
    summary: textField,
    visualNotes: textField,
    storyRole: textField,
    importance: { type: 'string', enum: [...DRAMA_ASSET_IMPORTANCES] },
    identity: textField,
    personality: textField,
    wardrobeDefault: textField,
    voiceNotes: textField,
    placeType: textField,
    timeOfDay: textField,
    atmosphere: textField,
    spatialNotes: textField,
    ownerName: textField,
    category: textField,
    significance: textField,
  },
};

const deleteInputSchema: AgentToolSchema = {
  type: 'object',
  required: ['assetId'],
  additionalProperties: false,
  properties: {
    scope: scopeProperty,
    assetId: { type: 'string', minLength: 1, maxLength: 160 },
  },
};

interface UpsertAssetInput extends Record<string, unknown> {
  scope?: CharacterLibraryScope;
  kind: DramaAssetKind;
  assetId?: string;
  name?: string;
}

function createAssetId(kind: DramaAssetKind): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 收集本次要写入的字段，并拦截与 kind 不符的专属字段。 */
function collectAssetPatch(
  input: UpsertAssetInput,
): { patch: Record<string, unknown> } | { error: string } {
  const allowed = new Set([...SHARED_FIELDS, ...KIND_FIELDS[input.kind]]);
  const foreign = Object.keys(input).filter((field) => (
    !allowed.has(field)
    && !['scope', 'kind', 'assetId'].includes(field)
  ));
  if (foreign.length > 0) {
    return { error: `字段 ${foreign.join('、')} 不属于${input.kind}类资产` };
  }
  const patch: Record<string, unknown> = {};
  for (const field of allowed) {
    const value = input[field];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) patch[field] = trimmed;
    } else if (value !== undefined) {
      patch[field] = value;
    }
  }
  return { patch };
}

export function registerDramaAssetAgentTools(): Array<() => void> {
  return [
    registerAgentTool<{ kind?: DramaAssetKind; scope?: CharacterLibraryScope }>({
      id: 'drama_asset_list',
      title: '查询短剧资产',
      description:
        '列出已入库的人物、场景与道具，含可直接写进提示词的 @drama 引用串。'
        + 'scope=project（默认）查当前项目资产库，scope=global 查跨项目角色库。'
        + '需要某个资产的完整设定时再调用 drama_asset_get。',
      inputSchema: listInputSchema,
      effect: 'read',
      authorize: authorizeScope,
      summarizeInput: (input) => input.kind
        ? `查询短剧资产（${input.kind}）`
        : '查询短剧资产',
      execute: async (_context, input): Promise<AgentToolExecutionResult> => {
        const assets = listScopedAssets(input.scope)
          .filter((asset) => !input.kind || asset.kind === input.kind)
          .map(summarizeAsset);
        return {
          status: 'success',
          summary: `找到 ${assets.length} 个短剧资产`,
          modelContent: JSON.stringify({ scope: input.scope ?? 'project', assets }),
        };
      },
    }),
    registerAgentTool<{ assetId: string; scope?: CharacterLibraryScope }>({
      id: 'drama_asset_get',
      title: '读取短剧资产',
      description:
        '按 ID 读取一个人物、场景或道具的完整设定简报（身份、外形、声音、关系等），'
        + '用于生成提示词或分镜时保持设定一致。',
      inputSchema: getInputSchema,
      effect: 'read',
      authorize: authorizeScope,
      summarizeInput: (input) => `读取短剧资产 ${input.assetId}`,
      execute: async (_context, input): Promise<AgentToolExecutionResult> => {
        const asset = findScopedAsset(input.scope, input.assetId);
        if (!asset) {
          return {
            status: 'error',
            summary: '未找到该短剧资产',
            modelContent: `短剧资产 ${input.assetId} 不存在，请先调用 drama_asset_list 获取可用 ID`,
          };
        }
        const character = asset.kind === 'character' ? asset as DramaCharacter : undefined;
        return {
          status: 'success',
          summary: `已读取「${asset.name}」`,
          modelContent: JSON.stringify({
            id: asset.id,
            kind: asset.kind,
            name: asset.name,
            mention: formatDramaMention(asset.id, asset.name),
            brief: formatDramaAssetTextBrief(asset),
            referenceImageCount: character?.referenceImages?.length ?? (asset.imageUrl ? 1 : 0),
            voiceClips: character?.voiceClips?.map((clip) => ({
              id: clip.id,
              kind: clip.kind,
              label: clip.label,
              transcript: clip.transcript || undefined,
              isPrimary: clip.id === character.primaryVoiceClipId,
            })) ?? [],
          }),
        };
      },
    }),
    registerAgentTool<UpsertAssetInput>({
      id: 'drama_asset_upsert',
      title: '新增或修改资产',
      description: [
        '新增或修改人物、场景、道具设定。给 assetId 表示改已有资产，省略则新建。',
        'scope=project（默认）写当前项目资产库；scope=global 写跨项目角色库，只能是 character。',
        '专属字段按类型区分：人物 identity/personality/wardrobeDefault/voiceNotes，',
        '场景 placeType/timeOfDay/atmosphere/spatialNotes，道具 ownerName/category/significance。',
        '参考图和音色片段不在这里维护，需要用户在界面上绑定。每次写入都要用户确认。',
      ].join(''),
      inputSchema: upsertInputSchema,
      effect: 'asset_write',
      authorize: (context, input) => {
        if (input.scope === 'global' && input.kind !== 'character') {
          return { allowed: false, reason: '全局角色库只保存人物资产' };
        }
        return authorizeScope(context, input);
      },
      summarizeInput: (input) => {
        const target = input.name || input.assetId || '新资产';
        return `${input.assetId ? '修改' : '新增'}${input.scope === 'global' ? '全局' : '项目'}资产「${target}」`;
      },
      execute: async (_context, input): Promise<AgentToolExecutionResult> => {
        const collected = collectAssetPatch(input);
        if ('error' in collected) {
          return { status: 'error', summary: collected.error, modelContent: collected.error };
        }
        const existing = input.assetId ? findScopedAsset(input.scope, input.assetId) : undefined;
        if (input.assetId && !existing) {
          const message = `资产 ${input.assetId} 不存在，新建时请省略 assetId`;
          return { status: 'error', summary: message, modelContent: message };
        }
        if (existing && existing.kind !== input.kind) {
          const message = `资产 ${input.assetId} 是${existing.kind}，不能改成${input.kind}`;
          return { status: 'error', summary: message, modelContent: message };
        }
        if (!existing && !input.name) {
          return { status: 'error', summary: '新建资产必须提供 name', modelContent: '新建资产必须提供 name' };
        }

        const now = Date.now();
        const merged = {
          // 已有资产保留参考图、音色、绑定节点等这里管不到的字段
          ...(existing ?? {
            id: createAssetId(input.kind),
            kind: input.kind,
            key: input.name,
            summary: '',
            visualNotes: '',
            importance: 'supporting' as DramaAssetImportance,
            confirmed: true,
            createdAt: now,
            source: 'manual' as const,
            ...(input.kind === 'character' ? { identity: '' } : {}),
          }),
          ...collected.patch,
          updatedAt: now,
        } as DramaAsset;

        const store = useAppStore.getState();
        if (input.scope === 'global' || merged.kind === 'character') {
          const saved = await store.saveCharacterCard(
            input.scope ?? 'project',
            normalizeDramaCharacter(merged as DramaCharacter),
          );
          if (!saved) {
            return { status: 'error', summary: '角色保存失败', modelContent: '角色保存失败' };
          }
        } else {
          store.upsertDramaAsset(merged);
        }
        return {
          status: 'success',
          summary: `${existing ? '已修改' : '已新增'}资产「${merged.name}」`,
          modelContent: JSON.stringify({
            id: merged.id,
            kind: merged.kind,
            name: merged.name,
            scope: input.scope ?? 'project',
            mention: formatDramaMention(merged.id, merged.name),
            created: !existing,
          }),
        };
      },
    }),
    registerAgentTool<{ assetId: string; scope?: CharacterLibraryScope }>({
      id: 'drama_asset_delete',
      title: '删除资产',
      description:
        '从项目资产库或全局角色库删除一个资产。资产库没有撤销，删除后只能重新录入，'
        + '每次都需要用户二次确认。画布上已生成的图像节点不会被删除。',
      inputSchema: deleteInputSchema,
      effect: 'permanent_delete',
      authorize: authorizeScope,
      summarizeInput: (input) => {
        const asset = findScopedAsset(input.scope, input.assetId);
        return `删除${input.scope === 'global' ? '全局' : '项目'}资产「${asset?.name ?? input.assetId}」`;
      },
      execute: async (_context, input): Promise<AgentToolExecutionResult> => {
        const asset = findScopedAsset(input.scope, input.assetId);
        if (!asset) {
          const message = `资产 ${input.assetId} 不存在`;
          return { status: 'error', summary: message, modelContent: message };
        }
        const store = useAppStore.getState();
        if (input.scope === 'global') {
          const deleted = await store.deleteGlobalCharacter(input.assetId);
          if (!deleted) {
            return { status: 'error', summary: '全局角色删除失败', modelContent: '全局角色删除失败' };
          }
        } else {
          store.deleteDramaAsset(asset.kind, input.assetId);
        }
        return {
          status: 'success',
          summary: `已删除资产「${asset.name}」`,
          modelContent: JSON.stringify({
            id: input.assetId,
            kind: asset.kind,
            scope: input.scope ?? 'project',
          }),
        };
      },
    }),
    registerAgentTool<{ assetId: string; clipId: string; scope?: CharacterLibraryScope; kind?: CharacterVoiceKind; label?: string; transcript?: string }>({
      id: 'drama_voice_update',
      title: '更新角色声音',
      description: '更新已有角色声音片段的用途、名称或台词描述；不接受音频路径或 URL。',
      inputSchema: { type: 'object', required: ['assetId', 'clipId'], additionalProperties: false, properties: {
        assetId: { type: 'string', minLength: 1, maxLength: 160 }, clipId: { type: 'string', minLength: 1, maxLength: 160 }, scope: scopeProperty,
        kind: { type: 'string', enum: ['timbre', 'line', 'emotion', 'other'] }, label: { type: 'string', maxLength: 120 }, transcript: { type: 'string', maxLength: 4000 },
      } },
      effect: 'asset_write',
      authorize: authorizeScope,
      execute: async (_context, input) => {
        const asset = findScopedAsset(input.scope, input.assetId);
        if (asset?.kind !== 'character' || !asset.voiceClips?.some((clip) => clip.id === input.clipId)) {
          return { status: 'error', summary: '角色声音片段不存在', modelContent: '角色声音片段不存在' };
        }
        const saved = await useAppStore.getState().updateCharacterVoiceClip(input.scope ?? 'project', asset.id, input.clipId, { kind: input.kind, label: input.label?.trim(), transcript: input.transcript });
        return saved ? { status: 'success', summary: '已更新角色声音片段', modelContent: JSON.stringify({ assetId: asset.id, clipId: input.clipId }) } : { status: 'error', summary: '角色声音更新失败', modelContent: '角色声音更新失败' };
      },
    }),
    registerAgentTool<{ assetId: string; clipId: string; scope?: CharacterLibraryScope }>({
      id: 'drama_voice_set_primary',
      title: '设置角色主声音',
      description: '将一个已有声音片段设为角色默认主音色。',
      inputSchema: { type: 'object', required: ['assetId', 'clipId'], additionalProperties: false, properties: { assetId: { type: 'string', minLength: 1, maxLength: 160 }, clipId: { type: 'string', minLength: 1, maxLength: 160 }, scope: scopeProperty } },
      effect: 'asset_write',
      authorize: authorizeScope,
      execute: async (_context, input) => {
        const saved = await useAppStore.getState().setCharacterPrimaryVoice(input.scope ?? 'project', input.assetId, input.clipId);
        return saved ? { status: 'success', summary: '已设置角色主声音', modelContent: JSON.stringify({ assetId: input.assetId, clipId: input.clipId }) } : { status: 'error', summary: '角色或声音片段不存在', modelContent: '角色或声音片段不存在' };
      },
    }),
    registerAgentTool<{ assetId: string; clipId: string; scope?: CharacterLibraryScope }>({
      id: 'drama_voice_delete',
      title: '删除角色声音',
      description: '永久移除一个角色声音片段；不删除画布音频节点和共用文件。',
      inputSchema: { type: 'object', required: ['assetId', 'clipId'], additionalProperties: false, properties: { assetId: { type: 'string', minLength: 1, maxLength: 160 }, clipId: { type: 'string', minLength: 1, maxLength: 160 }, scope: scopeProperty } },
      effect: 'permanent_delete',
      authorize: authorizeScope,
      execute: async (_context, input) => {
        const deleted = await useAppStore.getState().removeCharacterVoiceClip(input.scope ?? 'project', input.assetId, input.clipId);
        return deleted ? { status: 'success', summary: '已删除角色声音片段', modelContent: JSON.stringify({ deleted: true, assetId: input.assetId, clipId: input.clipId }) } : { status: 'error', summary: '角色或声音片段不存在', modelContent: '角色或声音片段不存在' };
      },
    }),
  ];
}
