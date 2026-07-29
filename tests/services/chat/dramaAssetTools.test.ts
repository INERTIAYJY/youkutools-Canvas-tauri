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
});
