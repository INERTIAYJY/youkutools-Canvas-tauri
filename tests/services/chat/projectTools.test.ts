import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerProjectAgentTools } from '../../../src/services/chat/tools/projectTools';
import {
  clearAgentToolRegistryForTests,
  getAvailableAgentTools,
  getAgentTool,
  type AgentToolContext,
} from '../../../src/services/chat/toolRegistry';
import { useAppStore } from '../../../src/store/useAppStore';
import { validateAgentToolInput } from '../../../src/services/chat/agentToolSchemas';

function context(): AgentToolContext {
  return {
    taskId: 'task-project-tools',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    mode: 'autonomous',
    baseRevision: 3,
    signal: new AbortController().signal,
  };
}

let unregisters: Array<() => void> = [];

beforeEach(() => {
  clearAgentToolRegistryForTests();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    currentProjectId: 'project-1',
    projectLoadStatus: 'ready',
    projects: [{
      id: 'project-1',
      name: '主项目',
      createdAt: 1,
      updatedAt: 2,
      dataFolder: 'private-folder',
      snapshot: 'data:image/png;base64,private',
      settings: {
        visualStyle: {
          styleId: 'cinematic',
          styleName: '电影感',
          prompt: 'cinematic light',
          locked: true,
          styleReference: {
            filePath: 'C:\\private\\style.png',
            imageUrl: 'asset://private-style',
            fileName: 'style.png',
          },
        },
        promptSuffixes: { image: '保持角色一致' },
      },
    }, {
      id: 'episode-1',
      name: '第 1 集',
      createdAt: 3,
      updatedAt: 4,
      parentId: 'project-1',
      episodeNo: 1,
      episodeOutline: '不可在项目列表中泄露的正文',
    }],
  });
  unregisters = registerProjectAgentTools();
});

afterEach(() => {
  unregisters.forEach((unregister) => unregister());
  clearAgentToolRegistryForTests();
});

describe('project tools registration', () => {
  it('registers all project operations with accurate effects and closed schemas', () => {
    const expected = {
      project_list: 'read',
      project_get: 'read',
      project_create: 'canvas_write',
      project_rename: 'canvas_write',
      project_switch: 'canvas_write',
      project_update_settings: 'config_write',
      project_save: 'file_write',
      project_delete: 'permanent_delete',
    } as const;

    for (const [id, effect] of Object.entries(expected)) {
      const definition = getAgentTool(id);
      expect(definition?.effect).toBe(effect);
      expect(definition?.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('exposes project management only to the dedicated MCP conversation', () => {
    const internalTools = getAvailableAgentTools({
      ...context(),
      conversationId: 'conversation-1',
    });
    const mcpTools = getAvailableAgentTools({
      ...context(),
      conversationId: 'mcp-control-project-1',
    });

    expect(internalTools.some((tool) => tool.id === 'project_switch')).toBe(false);
    expect(internalTools.some((tool) => tool.id === 'project_delete')).toBe(false);
    expect(mcpTools.some((tool) => tool.id === 'project_switch')).toBe(true);
    expect(mcpTools.some((tool) => tool.id === 'project_delete')).toBe(true);
  });

  it('rejects local style-reference paths and arbitrary project setting fields', () => {
    const schema = getAgentTool('project_update_settings')!.inputSchema;

    expect(validateAgentToolInput(schema, {
      settings: {
        visualStyle: {
          styleReference: { filePath: 'C:\\private\\style.png' },
        },
      },
    })).toMatchObject({ valid: false });
    expect(validateAgentToolInput(schema, {
      settings: { unknownSetting: true },
    })).toMatchObject({ valid: false });
  });

  it('lists and reads projects without paths, snapshots or asset bodies', async () => {
    const list = await getAgentTool('project_list')!.execute(context(), {});
    const detail = await getAgentTool('project_get')!.execute(context(), {
      projectId: 'project-1',
    });

    expect(list.status).toBe('success');
    expect(JSON.parse(list.modelContent)).toEqual(expect.objectContaining({
      currentProjectId: 'project-1',
      projects: expect.arrayContaining([
        expect.objectContaining({ id: 'project-1', name: '主项目', current: true }),
        expect.objectContaining({ id: 'episode-1', parentId: 'project-1', episodeNo: 1 }),
      ]),
    }));
    expect(detail.status).toBe('success');
    expect(JSON.parse(detail.modelContent)).toMatchObject({
      id: 'project-1',
      settings: {
        visualStyle: {
          styleId: 'cinematic',
          styleName: '电影感',
          prompt: 'cinematic light',
          locked: true,
        },
        promptSuffixes: { image: '保持角色一致' },
      },
    });
    for (const content of [list.modelContent, detail.modelContent]) {
      expect(content).not.toContain('private-folder');
      expect(content).not.toContain('base64');
      expect(content).not.toContain('C:\\private');
      expect(content).not.toContain('asset://private-style');
      expect(content).not.toContain('不可在项目列表中泄露的正文');
    }
  });
});

describe('project write tools', () => {
  it('creates, renames and switches projects through existing Store actions', async () => {
    const createProject = vi.fn(async (name?: string) => {
      const project = { id: 'project-2', name: name ?? '新项目', createdAt: 5, updatedAt: 5 };
      useAppStore.setState((state) => ({ projects: [...state.projects, project] }));
      return project.id;
    });
    const renameProject = vi.fn(async (id: string, name: string) => {
      useAppStore.setState((state) => ({
        projects: state.projects.map((project) => project.id === id
          ? { ...project, name }
          : project),
      }));
      return true;
    });
    const switchProject = vi.fn((id: string) => {
      useAppStore.setState({ currentProjectId: id });
    });
    useAppStore.setState({ createProject, renameProject, switchProject });

    const created = await getAgentTool('project_create')!.execute(context(), { name: '第二项目' });
    const renamed = await getAgentTool('project_rename')!.execute(context(), {
      projectId: 'project-2',
      name: '重命名项目',
    });
    const switched = await getAgentTool('project_switch')!.execute(context(), {
      projectId: 'project-2',
    });

    expect(created.status).toBe('success');
    expect(renameProject).toHaveBeenCalledWith('project-2', '重命名项目');
    expect(renamed.status).toBe('success');
    expect(switchProject).toHaveBeenCalledWith('project-2', { captureSnapshot: false });
    expect(switched.status).toBe('success');
    expect(useAppStore.getState().currentProjectId).toBe('project-2');
  });

  it('rejects an all-whitespace project name before calling the Store', async () => {
    const createProject = vi.fn(async () => 'should-not-run');
    useAppStore.setState({ createProject });

    const result = await getAgentTool('project_create')!.execute(context(), { name: '   ' });

    expect(result).toMatchObject({
      status: 'error',
      errorCode: 'PROJECT_NAME_REQUIRED',
    });
    expect(createProject).not.toHaveBeenCalled();
  });

  it('deep-merges safe project settings and preserves private style reference state', async () => {
    const updateProjectSettings = vi.fn(async () => true);
    useAppStore.setState({ updateProjectSettings });

    const result = await getAgentTool('project_update_settings')!.execute(context(), {
      settings: {
        visualStyle: { locked: false },
        promptSuffixes: { video: '保持镜头运动连贯' },
        defaultModels: { image: 'apimart/gpt-image-2' },
        generation: { imageAspectRatio: '16:9', videoDuration: 8 },
      },
    });

    expect(result.status).toBe('success');
    expect(updateProjectSettings).toHaveBeenCalledWith({
      visualStyle: expect.objectContaining({
        styleId: 'cinematic',
        locked: false,
        styleReference: expect.objectContaining({ filePath: 'C:\\private\\style.png' }),
      }),
      promptSuffixes: {
        image: '保持角色一致',
        video: '保持镜头运动连贯',
      },
      defaultModels: { image: 'apimart/gpt-image-2' },
      generation: { imageAspectRatio: '16:9', videoDuration: 8 },
    });
  });

  it('saves the current project and permanently deletes an existing target', async () => {
    const saveCurrentProject = vi.fn(async () => 'project-1');
    const deleteProject = vi.fn(async (id: string) => {
      useAppStore.setState((state) => ({
        projects: state.projects.filter((project) => project.id !== id),
      }));
    });
    useAppStore.setState({ saveCurrentProject, deleteProject });

    const saved = await getAgentTool('project_save')!.execute(context(), {});
    const deleted = await getAgentTool('project_delete')!.execute(context(), {
      projectId: 'episode-1',
    });

    expect(saved.status).toBe('success');
    expect(saveCurrentProject).toHaveBeenCalledTimes(1);
    expect(deleted.status).toBe('success');
    expect(deleteProject).toHaveBeenCalledWith('episode-1');
    expect(useAppStore.getState().projects.some((project) => project.id === 'episode-1')).toBe(false);
  });
});
