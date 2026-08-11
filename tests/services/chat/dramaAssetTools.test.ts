import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/store/useAppStore';
import { registerDramaAssetAgentTools } from '../../../src/services/chat/tools/dramaAssetTools';
import {
  clearAgentToolRegistryForTests,
  getAgentTool,
  type AgentToolContext,
} from '../../../src/services/chat/toolRegistry';
import type { DramaCharacter } from '../../../src/types/dramaAssets';
import { emptyDramaAssetLibrary } from '../../../src/types/dramaAssets';

function character(overrides: Partial<DramaCharacter> = {}): DramaCharacter {
  return {
    kind: 'character',
    id: 'char_1',
    key: '沈砚',
    name: '沈砚',
    identity: '刑警',
    summary: '沉默寡言的刑警',
    visualNotes: '短发、疤',
    voiceNotes: '低沉沙哑，语速偏慢',
    importance: 'main',
    confirmed: true,
    createdAt: 1,
    updatedAt: 2,
    source: 'manual',
    primaryVoiceClipId: 'voice-1',
    voiceClips: [{
      id: 'voice-1',
      kind: 'timbre',
      label: '低沉男声',
      audioUrl: 'asset:///project/data/voice.mp3',
      transcript: '你终于来了。',
      createdAt: 1,
      updatedAt: 2,
    }],
    ...overrides,
  };
}

function context(): AgentToolContext {
  return { projectId: 'p1' } as AgentToolContext;
}

beforeEach(() => {
  clearAgentToolRegistryForTests();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    currentProjectId: 'p1',
    dramaAssets: { ...emptyDramaAssetLibrary(), characters: [character()] },
  });
});

describe('drama asset agent tools', () => {
  it('lists assets as read-only with mention strings and voice availability', async () => {
    const unregisters = registerDramaAssetAgentTools();
    const definition = getAgentTool('drama_asset_list');

    expect(definition?.effect).toBe('read');
    const result = await definition!.execute(context(), {});
    const payload = JSON.parse(result.modelContent ?? '{}');

    expect(result.status).toBe('success');
    expect(payload.assets).toEqual([expect.objectContaining({
      id: 'char_1',
      kind: 'character',
      name: '沈砚',
      mention: '@drama{char_1:沈砚}',
      voiceClipCount: 1,
      hasVoice: true,
    })]);
    unregisters.forEach((unregister) => unregister());
  });

  it('returns the full brief including voice notes and clips', async () => {
    const unregisters = registerDramaAssetAgentTools();
    const definition = getAgentTool('drama_asset_get');

    const result = await definition!.execute(context(), { assetId: 'char_1' });
    const payload = JSON.parse(result.modelContent ?? '{}');

    expect(payload.brief).toContain('声音：低沉沙哑，语速偏慢');
    expect(payload.voiceClips).toEqual([expect.objectContaining({
      id: 'voice-1',
      isPrimary: true,
      transcript: '你终于来了。',
    })]);
    unregisters.forEach((unregister) => unregister());
  });

  it('refuses to read assets from another project', async () => {
    const unregisters = registerDramaAssetAgentTools();
    const definition = getAgentTool('drama_asset_list');

    expect(definition?.authorize?.({ projectId: 'other' } as AgentToolContext, {}))
      .toEqual(expect.objectContaining({ allowed: false }));
    unregisters.forEach((unregister) => unregister());
  });

  it('creates a project asset behind the asset_write approval', async () => {
    const unregisters = registerDramaAssetAgentTools();
    const definition = getAgentTool('drama_asset_upsert')!;

    expect(definition.effect).toBe('asset_write');
    const result = await definition.execute(context(), {
      kind: 'scene',
      name: '雨夜天台',
      summary: '决战发生地',
      timeOfDay: '深夜',
    });
    const payload = JSON.parse(result.modelContent ?? '{}');
    const created = useAppStore.getState().dramaAssets.scenes[0];

    expect(result.status).toBe('success');
    expect(created).toMatchObject({
      kind: 'scene',
      name: '雨夜天台',
      timeOfDay: '深夜',
      source: 'manual',
    });
    expect(payload.mention).toBe(`@drama{${created.id}:雨夜天台}`);
    unregisters.forEach((unregister) => unregister());
  });

  it('rejects fields that belong to another asset kind and unknown ids', async () => {
    const unregisters = registerDramaAssetAgentTools();
    const definition = getAgentTool('drama_asset_upsert')!;

    const crossKind = await definition.execute(context(), {
      kind: 'scene',
      name: '天台',
      identity: '刑警',
    });
    expect(crossKind.status).toBe('error');
    expect(crossKind.summary).toContain('identity');

    const missing = await definition.execute(context(), { kind: 'scene', assetId: 'scene-nope' });
    expect(missing.status).toBe('error');
    expect(useAppStore.getState().dramaAssets.scenes).toHaveLength(0);
    unregisters.forEach((unregister) => unregister());
  });

  it('patches an existing character without dropping its voice clips', async () => {
    const unregisters = registerDramaAssetAgentTools();

    const result = await getAgentTool('drama_asset_upsert')!.execute(context(), {
      kind: 'character',
      assetId: 'char_1',
      wardrobeDefault: '黑色风衣',
    });
    const updated = useAppStore.getState().dramaAssets.characters[0];

    expect(result.status).toBe('success');
    expect(updated.wardrobeDefault).toBe('黑色风衣');
    // 参考图 / 音色片段不在工具的字段范围里，改设定不能把它们冲掉
    expect(updated.voiceClips).toHaveLength(1);
    expect(updated.summary).toBe('沉默寡言的刑警');
    unregisters.forEach((unregister) => unregister());
  });

  it('deletes assets as a permanent delete', async () => {
    const unregisters = registerDramaAssetAgentTools();
    const definition = getAgentTool('drama_asset_delete')!;

    expect(definition.effect).toBe('permanent_delete');
    const result = await definition.execute(context(), { assetId: 'char_1' });

    expect(result.status).toBe('success');
    expect(useAppStore.getState().dramaAssets.characters).toHaveLength(0);
    unregisters.forEach((unregister) => unregister());
  });

  it('keeps the global character library to characters only', async () => {
    const unregisters = registerDramaAssetAgentTools();
    const definition = getAgentTool('drama_asset_upsert')!;

    expect(definition.authorize?.(
      { projectId: 'other' } as AgentToolContext,
      { scope: 'global', kind: 'scene', name: '天台' },
    )).toEqual(expect.objectContaining({ allowed: false }));
    // 全局角色库不属于任何项目，项目没加载也能写
    expect(definition.authorize?.(
      { projectId: 'other' } as AgentToolContext,
      { scope: 'global', kind: 'character', name: '沈砚' },
    )).toEqual(expect.objectContaining({ allowed: true }));
    unregisters.forEach((unregister) => unregister());
  });
});
