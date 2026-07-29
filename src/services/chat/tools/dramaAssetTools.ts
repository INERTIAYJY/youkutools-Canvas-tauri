/**
 * 注册短剧资产（人物/场景/道具）只读工具，让 Agent 先发现项目里已有的角色与场景，
 * 再用 @drama{id:name} 引用它们，而不是凭空重新描述。工具只读，不写画布也不改资产。
 */
import { useAppStore } from '../../../store/useAppStore';
import type { DramaAsset, DramaAssetKind, DramaCharacter } from '../../../types/dramaAssets';
import { formatDramaMention } from '../../../types/dramaAssets';
import { findDramaAsset, formatDramaAssetTextBrief, listDramaAssetsFlat } from '../../dramaAssetPrompt';
import {
  registerAgentTool,
  type AgentToolExecutionResult,
} from '../toolRegistry';
import type { AgentToolSchema } from '../agentToolSchemas';

const DRAMA_ASSET_KINDS: DramaAssetKind[] = ['character', 'scene', 'prop'];

function authorizeCurrentProject(context: { projectId: string }) {
  return useAppStore.getState().currentProjectId === context.projectId
    ? { allowed: true }
    : { allowed: false, reason: '目标项目当前未加载，不能读取其他项目的短剧资产' };
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

const listInputSchema: AgentToolSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: DRAMA_ASSET_KINDS },
  },
};

const getInputSchema: AgentToolSchema = {
  type: 'object',
  required: ['assetId'],
  additionalProperties: false,
  properties: {
    assetId: { type: 'string', minLength: 1, maxLength: 160 },
  },
};

export function registerDramaAssetAgentTools(): Array<() => void> {
  return [
    registerAgentTool<{ kind?: DramaAssetKind }>({
      id: 'drama_asset_list',
      title: '查询短剧资产',
      description:
        '列出当前项目已入库的人物、场景与道具，含可直接写进提示词的 @drama 引用串。'
        + '需要某个资产的完整设定时再调用 drama_asset_get。',
      inputSchema: listInputSchema,
      effect: 'read',
      authorize: authorizeCurrentProject,
      summarizeInput: (input) => input.kind
        ? `查询短剧资产（${input.kind}）`
        : '查询短剧资产',
      execute: async (_context, input): Promise<AgentToolExecutionResult> => {
        const library = useAppStore.getState().dramaAssets;
        const assets = listDramaAssetsFlat(library)
          .filter((asset) => !input.kind || asset.kind === input.kind)
          .map(summarizeAsset);
        return {
          status: 'success',
          summary: `找到 ${assets.length} 个短剧资产`,
          modelContent: JSON.stringify({ assets }),
        };
      },
    }),
    registerAgentTool<{ assetId: string }>({
      id: 'drama_asset_get',
      title: '读取短剧资产',
      description:
        '按 ID 读取一个人物、场景或道具的完整设定简报（身份、外形、声音、关系等），'
        + '用于生成提示词或分镜时保持设定一致。',
      inputSchema: getInputSchema,
      effect: 'read',
      authorize: authorizeCurrentProject,
      summarizeInput: (input) => `读取短剧资产 ${input.assetId}`,
      execute: async (_context, input): Promise<AgentToolExecutionResult> => {
        const library = useAppStore.getState().dramaAssets;
        const asset = findDramaAsset(library, input.assetId);
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
  ];
}
