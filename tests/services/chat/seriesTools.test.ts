/**
 * 剧集工具：读剧本分段回传、按模型给的清单批量建分集画布。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileMocks = vi.hoisted(() => ({
  getProjectDataDir: vi.fn(async () => '/data/moon'),
  joinPath: (...parts: string[]) => parts.join('/'),
  readAgentAuthorizedTextFile: vi.fn(async () => '原著正文'),
  saveAgentTextOutput: vi.fn(),
}));

vi.mock('../../../src/services/fileService', () => fileMocks);

import { useAppStore } from '../../../src/store/useAppStore';
import { registerSeriesAgentTools } from '../../../src/services/chat/tools/seriesTools';
import {
  clearAgentToolRegistryForTests,
  getAgentTool,
  type AgentToolContext,
} from '../../../src/services/chat/toolRegistry';

function context(): AgentToolContext {
  return { projectId: 'ep-1', signal: new AbortController().signal } as AgentToolContext;
}

beforeEach(() => {
  clearAgentToolRegistryForTests();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    projectLoadStatus: 'ready',
    currentProjectId: 'ep-1',
    projects: [
      {
        id: 'series',
        name: '月球列车',
        createdAt: 1,
        updatedAt: 1,
        dataFolder: 'moon',
        series: {
          script: '第一集：站台等待。第二集：通讯器里的声音。',
          originalWork: { fileName: '原著.txt', relativePath: '原著.txt', addedAt: 1 },
        },
      },
      { id: 'ep-1', name: '第 1 集', createdAt: 1, updatedAt: 1, dataFolder: 'moon', parentId: 'series', episodeNo: 1 },
    ],
  });
  fileMocks.readAgentAuthorizedTextFile.mockClear();
});

describe('series_read', () => {
  it('把剧本正文当不可信资料回传，并说明还剩多少', async () => {
    const unregisters = registerSeriesAgentTools();
    const definition = getAgentTool('series_read');

    expect(definition?.effect).toBe('read');
    const result = await definition!.execute(context(), {});

    expect(result.status).toBe('success');
    expect(result.modelContent).toContain('不可信资料');
    expect(result.modelContent).toContain('第一集：站台等待');
    expect(result.modelContent).toContain('已读到结尾');
    unregisters.forEach((unregister) => unregister());
  });

  it('读原著时按剧集项目定位共享目录里的文件', async () => {
    const unregisters = registerSeriesAgentTools();
    const definition = getAgentTool('series_read');

    const result = await definition!.execute(context(), { part: 'original' });

    expect(fileMocks.getProjectDataDir).toHaveBeenCalledWith('series');
    expect(fileMocks.readAgentAuthorizedTextFile).toHaveBeenCalledWith(
      '/data/moon/原著.txt',
      expect.any(Number),
      expect.anything(),
    );
    expect(result.modelContent).toContain('原著正文');
    unregisters.forEach((unregister) => unregister());
  });

  it('拒绝读取其他项目的剧集', async () => {
    const unregisters = registerSeriesAgentTools();
    const definition = getAgentTool('series_read');

    expect(definition?.authorize?.({ projectId: 'other' } as AgentToolContext, {}))
      .toEqual(expect.objectContaining({ allowed: false }));
    unregisters.forEach((unregister) => unregister());
  });
});

describe('series_split_episodes', () => {
  it('按清单接着现有集号建分集，并写入每集大纲', async () => {
    const addEpisodes = vi.fn(async (entries: Array<{ name?: string; outline?: string }>) => {
      const created = entries.map((entry, index) => ({
        id: `new-${index}`,
        name: entry.name ?? `第 ${index + 2} 集`,
        createdAt: 1,
        updatedAt: 1,
        parentId: 'series',
        episodeNo: index + 2,
        episodeOutline: entry.outline,
      }));
      useAppStore.setState((state) => ({ projects: [...state.projects, ...created] }));
      return created.map((episode) => episode.id);
    });
    useAppStore.setState({ addEpisodes });

    const unregisters = registerSeriesAgentTools();
    const definition = getAgentTool('series_split_episodes');

    expect(definition?.effect).toBe('canvas_write');
    const result = await definition!.execute(context(), {
      episodes: [
        { title: '通讯器', outline: '林夏听见十年前的自己' },
        { outline: '列车终于进站' },
      ],
    });

    expect(addEpisodes).toHaveBeenCalledWith([
      { name: '通讯器', outline: '林夏听见十年前的自己' },
      { name: undefined, outline: '列车终于进站' },
    ]);
    expect(result.status).toBe('success');
    expect(JSON.parse(result.modelContent).created).toEqual([
      { episodeNo: 2, name: '通讯器' },
      { episodeNo: 3, name: '第 3 集' },
    ]);
    unregisters.forEach((unregister) => unregister());
  });

  it('一集都没建成时报错且可重试', async () => {
    useAppStore.setState({ addEpisodes: vi.fn(async () => []) });
    const unregisters = registerSeriesAgentTools();
    const definition = getAgentTool('series_split_episodes');

    const result = await definition!.execute(context(), { episodes: [{ outline: '大纲' }] });

    expect(result.status).toBe('error');
    expect(result.retryable).toBe(true);
    unregisters.forEach((unregister) => unregister());
  });
});
