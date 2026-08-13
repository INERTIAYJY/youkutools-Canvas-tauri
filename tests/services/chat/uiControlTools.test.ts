import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAgentToolRegistryForTests,
  getAvailableAgentTools,
  getAgentTool,
  type AgentToolContext,
} from '../../../src/services/chat/toolRegistry';
import { registerUiControlAgentTools } from '../../../src/services/chat/tools/uiControlTools';
import { useAppStore } from '../../../src/store/useAppStore';

vi.mock('../../../src/services/mcp/mcpUiRuntimeService', () => ({
  captureAppWindow: vi.fn(async () => ({
    data: 'YWJj',
    mimeType: 'image/jpeg',
    width: 640,
    height: 360,
  })),
  focusAppWindow: vi.fn(async () => undefined),
  getAppWindowState: vi.fn(async (label: string) => ({ label, visible: true })),
  listAppWindows: vi.fn(async () => [{ label: 'main', visible: true }]),
  setAppWindowBounds: vi.fn(async () => undefined),
}));

function context(conversationId = 'mcp-control-project-1'): AgentToolContext {
  return {
    taskId: 'task-ui',
    projectId: 'project-1',
    conversationId,
    mode: 'autonomous',
    baseRevision: 0,
    signal: new AbortController().signal,
  };
}

let unregisters: Array<() => void> = [];

beforeEach(() => {
  clearAgentToolRegistryForTests();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    currentProjectId: 'project-1',
    projects: [{ id: 'project-1', name: '项目', createdAt: 1, updatedAt: 1 }],
  });
  unregisters = registerUiControlAgentTools();
});

afterEach(() => {
  unregisters.forEach((unregister) => unregister());
  clearAgentToolRegistryForTests();
});

describe('MCP UI control tools', () => {
  it('registers the complete UI, window, viewport and screenshot set as MCP-only', () => {
    const expected = {
      ui_get_layout: 'read',
      ui_get_interaction_state: 'read',
      ui_set_layout: 'config_write',
      window_list: 'read',
      window_get_state: 'read',
      window_focus: 'config_write',
      window_set_bounds: 'config_write',
      canvas_get_viewport: 'read',
      canvas_set_viewport: 'canvas_write',
      canvas_fit_view: 'canvas_write',
      ui_capture_window: 'read',
    } as const;

    for (const [id, effect] of Object.entries(expected)) {
      expect(getAgentTool(id)).toMatchObject({ effect });
      expect(getAgentTool(id)?.inputSchema.additionalProperties).toBe(false);
    }

    expect(getAvailableAgentTools(context('conversation-1')).some((tool) => tool.id === 'ui_get_layout')).toBe(false);
    expect(getAvailableAgentTools(context()).some((tool) => tool.id === 'ui_get_layout')).toBe(true);
  });

  it('reads and changes structured panel layout without exposing pending credential ids', async () => {
    useAppStore.setState({ pendingApiKeyConnectionId: 'private-connection' });
    const changed = await getAgentTool('ui_set_layout')!.execute(context(), {
      panel: 'settings',
      settingsTab: 'mcp',
      minimapVisible: false,
    });
    const read = await getAgentTool('ui_get_layout')!.execute(context(), {});

    expect(changed.status).toBe('success');
    expect(useAppStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialTab: 'mcp',
      minimapVisible: false,
    });
    expect(read.modelContent).not.toContain('private-connection');
    expect(JSON.parse(read.modelContent)).toMatchObject({
      panels: { settings: true },
      settingsTab: 'mcp',
      minimapVisible: false,
    });
  });

  it('returns a transient MCP image without putting base64 in model content', async () => {
    const result = await getAgentTool('ui_capture_window')!.execute(context(), {
      target: 'main',
      maxWidth: 640,
      quality: 0.7,
      redactSensitive: true,
    });

    expect(result.status).toBe('success');
    expect(result.modelContent).not.toContain('YWJj');
    expect(result.mcpContent).toEqual([{ type: 'image', data: 'YWJj', mimeType: 'image/jpeg' }]);
  });
});
