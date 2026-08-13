import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSeriesAgentTools } from '../../../src/services/chat/tools/seriesTools';
import { registerDramaAssetAgentTools } from '../../../src/services/chat/tools/dramaAssetTools';
import { registerConversationAgentTools } from '../../../src/services/chat/tools/conversationTools';
import { registerHistoryAgentTools } from '../../../src/services/chat/tools/historyTools';
import { clearAgentToolRegistryForTests, getAgentTool, type AgentToolContext } from '../../../src/services/chat/toolRegistry';
import { useAppStore } from '../../../src/store/useAppStore';

function context(): AgentToolContext {
  return { taskId: 'mcp-audit-task', projectId: 'series-1', conversationId: 'mcp-control-series-1', mode: 'autonomous', baseRevision: 0, signal: new AbortController().signal };
}

let unregisters: Array<() => void> = [];

beforeEach(() => {
  clearAgentToolRegistryForTests();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    currentProjectId: 'series-1',
    projects: [
      { id: 'series-1', name: '短剧', createdAt: 1, updatedAt: 1, series: { script: '全剧剧本' } },
      { id: 'episode-1', parentId: 'series-1', episodeNo: 1, episodeOutline: '第一集', name: '第 1 集', createdAt: 2, updatedAt: 2 },
    ],
  });
  unregisters = [...registerSeriesAgentTools(), ...registerDramaAssetAgentTools(), ...registerConversationAgentTools(), ...registerHistoryAgentTools()];
});

afterEach(() => {
  unregisters.forEach((unregister) => unregister());
  clearAgentToolRegistryForTests();
});

describe('MCP operation domains', () => {
  it('registers series, voice, conversation, task and history management tools', () => {
    const ids = [
      'series_get_state', 'series_update_script', 'episode_update_outline', 'episode_move', 'episode_delete',
      'drama_voice_update', 'drama_voice_set_primary', 'drama_voice_delete',
      'conversation_list', 'conversation_get', 'conversation_create', 'conversation_update', 'conversation_switch', 'conversation_delete',
      'agent_task_list', 'agent_task_get', 'agent_task_control', 'agent_task_delete',
      'history_undo', 'history_redo', 'history_list', 'history_delete_entry', 'history_clear_node', 'history_clear_all',
    ];
    for (const id of ids) expect(getAgentTool(id), id).toBeDefined();
  });

  it('updates episode content and reorders through existing Store actions', async () => {
    const updateEpisodeOutline = vi.fn(async () => true);
    const moveEpisode = vi.fn(async () => true);
    useAppStore.setState({ updateEpisodeOutline, moveEpisode });

    expect((await getAgentTool('episode_update_outline')!.execute(context(), { episodeId: 'episode-1', outline: '新大纲' })).status).toBe('success');
    expect((await getAgentTool('episode_move')!.execute(context(), { episodeId: 'episode-1', direction: 1 })).status).toBe('success');
    expect(updateEpisodeOutline).toHaveBeenCalledWith('episode-1', '新大纲');
    expect(moveEpisode).toHaveBeenCalledWith('episode-1', 1);
  });

  it('creates and deletes a conversation while protecting the MCP control conversation', async () => {
    const created = await getAgentTool('conversation_create')!.execute(context(), { title: '分析会话', activate: true });
    const conversationId = JSON.parse(created.modelContent).conversation.id as string;
    const deleted = await getAgentTool('conversation_delete')!.execute(context(), { conversationId });

    expect(created.status).toBe('success');
    expect(deleted.status).toBe('success');
    expect(useAppStore.getState().conversations.some((item) => item.id === conversationId)).toBe(false);
    expect(getAgentTool('conversation_delete')!.authorize?.(context(), { conversationId: 'mcp-control-series-1' })).toMatchObject({ allowed: false });
  });
});
