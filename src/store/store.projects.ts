/**
 * Project slice — multi-project management, save/load/init via IndexedDB
 */
import type { Node, Edge } from '@xyflow/react';
import type { StateCreator } from 'zustand';
import type { AppState } from './useAppStore';
import type { BaseNodeData, CanvasProject, NodeGroup, ProjectSettings } from '../types';
import type { ProjectSaveData } from '../services/fileService';
import { generateProjectId } from './store.utils';
import * as fileService from '../services/fileService';
import { resumePendingTasks, clearProjectTasks } from '../services/pollManager';
import { normalizeProjectSettings } from '../services/projectSettingsService';
import { captureCurrentCanvasSnapshot } from '../services/projectSnapshotService';
import { stopProjectAgentTasks } from '../services/chat/agentTaskControl';
import { cancelProjectCanvasDerivations } from '../services/canvasDerivationGuard';
import { clearConversationFileGrants } from '../services/chat/fileGrantService';
import {
  getLastActiveProjectId,
  setLastActiveProjectId,
} from '../services/indexedDbService';

type ProjectLoadStatus = 'loading' | 'ready' | 'error';
let activeProjectMetadataWrite: Promise<void> = Promise.resolve();

function getProjectGroups(data: { groups?: unknown } | null | undefined): NodeGroup[] {
  return Array.isArray(data?.groups) ? (data.groups as NodeGroup[]) : [];
}

function hasProjectCanvasData(data: ProjectSaveData | null): data is ProjectSaveData {
  return Boolean(data && Array.isArray(data.nodes) && Array.isArray(data.edges));
}

function rememberActiveProject(projectId: string): void {
  activeProjectMetadataWrite = activeProjectMetadataWrite
    .then(() => setLastActiveProjectId(projectId))
    .catch(() => {
      console.warn('[项目] 最近打开项目记录失败', { projectId });
    });
}

function replacePathPrefix(path: string | undefined, oldDir: string, newDir: string): string | undefined {
  if (!path) return path;
  const normalizedPath = path.replace(/\\/g, '/');
  const normalizedOldDir = oldDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedNewDir = newDir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedPath.startsWith(`${normalizedOldDir}/`)) return path;
  return `${normalizedNewDir}${normalizedPath.slice(normalizedOldDir.length)}`;
}

async function remapProjectNodePaths(
  nodes: Node<BaseNodeData>[],
  oldDir: string,
  newDir: string,
): Promise<Node<BaseNodeData>[]> {
  return Promise.all(nodes.map(async (node) => {
    const data = node.data as BaseNodeData;
    const nextFilePath = replacePathPrefix(data.filePath, oldDir, newDir);
    let changed = nextFilePath !== data.filePath;
    let nextData: BaseNodeData = changed ? { ...data, filePath: nextFilePath } : data;

    if (changed && nextFilePath) {
      const assetUrl = await fileService.getAssetUrlFromPath(nextFilePath);
      if (nextData.imageUrl) nextData.imageUrl = assetUrl;
      if (nextData.videoUrl) nextData.videoUrl = assetUrl;
      if (nextData.audioUrl) nextData.audioUrl = assetUrl;
    }

    if (Array.isArray(data.storyboardOverrides)) {
      const nextOverrides = await Promise.all(data.storyboardOverrides.map(async (override) => {
        if (!override) return override;
        const nextOverridePath = replacePathPrefix(override.filePath, oldDir, newDir);
        if (nextOverridePath === override.filePath) return override;
        changed = true;
        return {
          ...override,
          filePath: nextOverridePath,
          url: nextOverridePath ? await fileService.getAssetUrlFromPath(nextOverridePath) : override.url,
        };
      }));
      if (nextOverrides !== data.storyboardOverrides && nextOverrides.some((override, index) => override !== data.storyboardOverrides?.[index])) {
        nextData = nextData === data ? { ...data } : nextData;
        nextData.storyboardOverrides = nextOverrides;
      }
    }

    return changed ? { ...node, data: nextData } : node;
  }));
}

interface ProjectSaveWaiter {
  resolve: (projectId: string) => void;
  reject: (error: unknown) => void;
}

interface PendingProjectSave {
  record: ProjectSaveData;
  waiters: ProjectSaveWaiter[];
}

interface ProjectSaveQueue {
  running: boolean;
  pending: PendingProjectSave | null;
}

const projectSaveQueues = new Map<string, ProjectSaveQueue>();
let projectSwitchSequence = 0;

interface CapturedCanvasState {
  projectId: string;
  nodes: AppState['nodes'];
  edges: AppState['edges'];
  groups: AppState['groups'];
  viewportTransform: string;
}

interface CaptureProjectSnapshotOptions {
  allowProjectChange?: boolean;
  persistRecord?: ProjectSaveData | null;
}

let lastCapturedCanvasState: CapturedCanvasState | null = null;

function getCanvasViewportTransform(): string {
  if (typeof document === 'undefined') return '';
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  return viewport?.style.transform ?? '';
}

function isCanvasSnapshotFresh(state: AppState, projectId: string): boolean {
  return lastCapturedCanvasState?.projectId === projectId
    && lastCapturedCanvasState.nodes === state.nodes
    && lastCapturedCanvasState.edges === state.edges
    && lastCapturedCanvasState.groups === state.groups
    && lastCapturedCanvasState.viewportTransform === getCanvasViewportTransform();
}

async function drainProjectSaveQueue(projectId: string, queue: ProjectSaveQueue): Promise<void> {
  if (queue.running) return;
  queue.running = true;

  try {
    while (queue.pending) {
      const batch = queue.pending;
      queue.pending = null;

      try {
        const savedProjectId = await fileService.saveProject(batch.record);
        batch.waiters.forEach((waiter) => waiter.resolve(savedProjectId));
      } catch (error) {
        batch.waiters.forEach((waiter) => waiter.reject(error));
      }
    }
  } finally {
    queue.running = false;
    if (queue.pending) {
      void drainProjectSaveQueue(projectId, queue);
    } else if (projectSaveQueues.get(projectId) === queue) {
      projectSaveQueues.delete(projectId);
    }
  }
}

function enqueueProjectSave(record: ProjectSaveData): Promise<string> {
  let queue = projectSaveQueues.get(record.id);
  if (!queue) {
    queue = { running: false, pending: null };
    projectSaveQueues.set(record.id, queue);
  }

  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    if (queue.pending) {
      queue.pending.record = record;
      queue.pending.waiters.push(waiter);
    } else {
      queue.pending = { record, waiters: [waiter] };
    }
    void drainProjectSaveQueue(record.id, queue);
  });
}

function createCurrentProjectSaveRecord(state: AppState): ProjectSaveData | null {
  const projectId = state.currentProjectId;
  const project = state.projects.find((item) => item.id === projectId);
  if (!projectId || !project || state.projectLoadStatus !== 'ready') return null;

  return {
    id: projectId,
    name: state.projectName,
    createdAt: project.createdAt,
    updatedAt: Date.now(),
    snapshot: project.snapshot,
    dataFolder: project.dataFolder,
    settings: project.settings,
    nodes: state.nodes,
    edges: state.edges,
    groups: state.groups,
    dramaAssets: state.dramaAssets,
  };
}

export interface ProjectSlice {
  projects: CanvasProject[];
  currentProjectId: string | null;
  projectName: string;
  projectLoadStatus: ProjectLoadStatus;
  _autoSaveFailedNotified?: boolean;
  setProjectName: (name: string) => void;
  renameProject: (id: string, name: string) => Promise<boolean>;
  updateProjectSettings: (settings: ProjectSettings) => Promise<boolean>;
  captureCurrentProjectSnapshot: (
    options?: CaptureProjectSnapshotOptions,
  ) => Promise<string | undefined>;
  createProject: (name?: string) => void;
  deleteProject: (id: string) => Promise<void>;
  switchProject: (id: string) => void;
  saveCurrentProject: () => Promise<string | undefined>;
  saveCurrentProjectSilent: () => Promise<string | undefined>;
  loadProject: () => Promise<void>;
  initFromDb: () => Promise<void>;
}

type ProjectSliceSet = Parameters<StateCreator<AppState, [], [], ProjectSlice>>[0];
type ProjectSliceGet = Parameters<StateCreator<AppState, [], [], ProjectSlice>>[1];

/**
 * 重命名事务的补偿动作：把物理目录、文件夹名映射、内存中的项目名与素材路径一并
 * 恢复到重命名前的状态。缺少它时，目录已改名而记录未落盘，重启后会按旧 dataFolder
 * 去找已经改名的目录，导致素材全部丢失。
 */
async function rollbackProjectRename(params: {
  set: ProjectSliceSet;
  get: ProjectSliceGet;
  id: string;
  previousProject: CanvasProject;
  previousDataFolder: string | undefined;
  renamed: fileService.ProjectDataDirRenameResult | null;
}): Promise<void> {
  const { set, get, id, previousProject, previousDataFolder, renamed } = params;
  try {
    await fileService.revertProjectDataDirRename(id, renamed, previousDataFolder);

    const current = get();
    const restoredNodes = renamed && current.currentProjectId === id
      ? await remapProjectNodePaths(current.nodes, renamed.newDir, renamed.oldDir)
      : null;

    set((state) => ({
      ...(state.currentProjectId === id
        ? { projectName: previousProject.name, ...(restoredNodes ? { nodes: restoredNodes } : {}) }
        : {}),
      projects: state.projects.map((item) => (
        item.id === id
          ? {
            ...item,
            name: previousProject.name,
            updatedAt: previousProject.updatedAt,
            dataFolder: previousDataFolder,
          }
          : item
      )),
    }));
  } catch (error) {
    console.error('[项目重命名] 回滚失败:', error);
  }
}

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set, get) => ({
  projects: [
    { id: 'default', name: '默认画布', createdAt: Date.now(), updatedAt: Date.now() },
  ],
  currentProjectId: 'default',
  projectName: '新项目',
  projectLoadStatus: 'loading',

  setProjectName: (name) => {
    const state = get();
    const currentProjectId = state.currentProjectId;
    if (!currentProjectId) {
      set({ projectName: name });
      return;
    }
    if (state.projects.find((project) => project.id === currentProjectId)?.name === name.trim()) return;
    void get().renameProject(currentProjectId, name);
  },

  renameProject: async (id, name) => {
    const nextName = name.trim();
    if (!nextName) return false;

    const initialState = get();
    const project = initialState.projects.find((item) => item.id === id);
    if (!project) return false;
    if (initialState.currentProjectId === id && initialState.projectLoadStatus !== 'ready') {
      get().showToast('项目尚未成功加载，已阻止重命名保存', 'error');
      return false;
    }

    const persistedProject = initialState.currentProjectId === id
      ? null
      : await fileService.loadProjectData(id);
    if (initialState.currentProjectId !== id && !persistedProject) {
      get().showToast('无法读取项目，重命名失败', 'error');
      return false;
    }

    const updatedAt = Date.now();
    const nextDataFolder = fileService.buildProjectFolderName(nextName, id);
    const oldDataFolder = project.dataFolder;
    const dataFolderChanged = oldDataFolder !== nextDataFolder;

    set((state) => ({
      ...(state.currentProjectId === id ? { projectName: nextName } : {}),
      projects: state.projects.map((item) =>
        item.id === id ? { ...item, name: nextName, updatedAt } : item
      ),
    }));

    let renamed: fileService.ProjectDataDirRenameResult | null = null;
    try {
      renamed = dataFolderChanged
        ? await fileService.renameProjectDataDir(id, oldDataFolder, nextDataFolder)
        : null;
      const latest = get();
      if (!latest.projects.some((item) => item.id === id)) return false;

      let nextNodes: Node<BaseNodeData>[];
      let record: ProjectSaveData;
      if (latest.currentProjectId === id) {
        nextNodes = renamed
          ? await remapProjectNodePaths(latest.nodes, renamed.oldDir, renamed.newDir)
          : latest.nodes;
        const latestProject = latest.projects.find((item) => item.id === id)!;
        record = {
          id,
          name: nextName,
          createdAt: latestProject.createdAt,
          updatedAt,
          snapshot: latestProject.snapshot,
          dataFolder: renamed?.dataFolder ?? latestProject.dataFolder,
          settings: latestProject.settings,
          nodes: nextNodes,
          edges: latest.edges,
          groups: latest.groups,
          dramaAssets: latest.dramaAssets,
        };
      } else {
        const source = persistedProject ?? await fileService.loadProjectData(id);
        if (!source) throw new Error('无法读取项目数据');
        nextNodes = renamed
          ? await remapProjectNodePaths(source.nodes as Node<BaseNodeData>[], renamed.oldDir, renamed.newDir)
          : source.nodes as Node<BaseNodeData>[];
        record = {
          ...source,
          name: nextName,
          updatedAt,
          dataFolder: renamed?.dataFolder ?? source.dataFolder,
          nodes: nextNodes,
        };
      }

      set((state) => ({
        ...(state.currentProjectId === id ? { projectName: nextName, nodes: nextNodes } : {}),
        projects: state.projects.map((item) => (
          item.id === id
            ? { ...item, name: nextName, updatedAt, dataFolder: record.dataFolder }
            : item
        )),
      }));
      await enqueueProjectSave(record);
      return true;
    } catch (error) {
      console.warn('[项目重命名] 保存失败，开始回滚:', error);
      await rollbackProjectRename({
        get,
        set,
        id,
        previousProject: project,
        previousDataFolder: oldDataFolder,
        renamed,
      });
      get().showToast('项目重命名失败，已恢复原名称', 'error');
      return false;
    }
  },

  updateProjectSettings: async (settings) => {
    const state = get();
    const projectId = state.currentProjectId;
    const previousProject = state.projects.find((project) => project.id === projectId);
    if (!projectId || !previousProject) return false;
    if (state.projectLoadStatus !== 'ready') {
      get().showToast('项目尚未成功加载，已阻止设置保存', 'error');
      return false;
    }

    const nextProject: CanvasProject = {
      ...previousProject,
      settings: normalizeProjectSettings(settings),
      updatedAt: Date.now(),
    };
    set((current) => ({
      projects: current.projects.map((project) => (
        project.id === projectId ? nextProject : project
      )),
    }));

    try {
      const record = createCurrentProjectSaveRecord(get());
      if (!record || record.id !== projectId) throw new Error('当前项目已切换，无法保存项目设置');
      await enqueueProjectSave({ ...record, updatedAt: nextProject.updatedAt });
      get().showToast('项目设置已保存');
      return true;
    } catch (error) {
      console.error('Save project settings failed:', error);
      set((current) => ({
        projects: current.projects.map((project) => (
          project.id === projectId ? previousProject : project
        )),
      }));
      get().showToast('项目设置保存失败', 'error');
      return false;
    }
  },

  captureCurrentProjectSnapshot: async (options = {}) => {
    const state = get();
    const projectId = state.currentProjectId;
    const project = state.projects.find((item) => item.id === projectId);
    if (!projectId || !project || state.projectLoadStatus !== 'ready') return undefined;

    if (state.nodes.length === 0) {
      lastCapturedCanvasState = null;
      if (project.snapshot) {
        set((current) => ({
          projects: current.projects.map((item) => (
            item.id === projectId ? { ...item, snapshot: undefined } : item
          )),
        }));
      }
      return projectId;
    }

    if (project.snapshot && isCanvasSnapshotFresh(state, projectId)) return projectId;

    const viewportTransform = getCanvasViewportTransform();
    const snapshot = await captureCurrentCanvasSnapshot(projectId);
    const latest = get();
    const projectStillExists = latest.projects.some((item) => item.id === projectId);
    if (!projectStillExists) return undefined;

    const isStillCurrent = latest.currentProjectId === projectId;
    const currentCanvasChanged = isStillCurrent && (
      latest.nodes !== state.nodes
      || latest.edges !== state.edges
      || latest.groups !== state.groups
      || getCanvasViewportTransform() !== viewportTransform
    );
    if (currentCanvasChanged || (!isStillCurrent && !options.allowProjectChange)) return undefined;

    if (snapshot) {
      lastCapturedCanvasState = {
        projectId,
        nodes: state.nodes,
        edges: state.edges,
        groups: state.groups,
        viewportTransform,
      };
      set((current) => ({
        projects: current.projects.map((item) => (
          item.id === projectId ? { ...item, snapshot } : item
        )),
      }));

      if (options.persistRecord) {
        const snapshotRecord: ProjectSaveData = {
          ...options.persistRecord,
          updatedAt: Date.now(),
          snapshot,
        };
        try {
          await enqueueProjectSave(snapshotRecord);
          set((current) => ({
            projects: current.projects.map((item) => (
              item.id === projectId
                ? { ...item, updatedAt: Math.max(item.updatedAt, snapshotRecord.updatedAt) }
                : item
            )),
          }));
        } catch (error) {
          console.warn('[项目快照] 持久化失败:', error);
        }
      }
    }
    return projectId;
  },

  createProject: (name) => {
    projectSwitchSequence += 1;
    const id = generateProjectId();
    let defaultName: string;
    if (name) {
      defaultName = name;
    } else {
      const existing = get().projects
        .filter((p) => p.id !== 'default')
        .map((p) => {
          const m = p.name.match(/^项目\s+(\d+)$/);
          return m ? parseInt(m[1], 10) : 0;
        });
      const nextNum = existing.length > 0 ? Math.max(...existing) + 1 : 1;
      defaultName = `项目 ${nextNum}`;
    }
    const dataFolder = fileService.buildProjectFolderName(defaultName, id);
    const project: CanvasProject = {
      id,
      name: defaultName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dataFolder,
    };
    fileService.registerProjectFolder(id, dataFolder);
    set((state) => ({
      projects: [...state.projects, project],
      currentProjectId: project.id,
      projectName: project.name,
      projectLoadStatus: 'ready',
      nodes: [],
      edges: [],
      groups: [],
      dramaAssets: { version: 2 as const, characters: [], scenes: [], props: [] },
    }));
    fileService.saveProject({ ...project, nodes: [], edges: [], groups: [], dramaAssets: { version: 2, characters: [], scenes: [], props: [] } }).catch((e) => console.warn('[创建项目] 保存失败:', e));
    fileService.ensureProjectDataDir(id).catch((e) => console.warn('[创建项目] 数据目录初始化失败:', e));
    rememberActiveProject(id);
    setTimeout(() => window.dispatchEvent(new CustomEvent('canvas-fit-view')), 0);
  },

  deleteProject: async (id) => {
    projectSwitchSequence += 1;
    const state = get();
    if (!state.projects.some((project) => project.id === id)) return;
    const filtered = state.projects.filter((p) => p.id !== id);
    const isCurrent = state.currentProjectId === id;
    cancelProjectCanvasDerivations(id);
    clearProjectTasks(id);
    // 先中止仍在运行的 Agent，再做最终级联删除，避免事务完成后再次写入项目任务。
    stopProjectAgentTasks(id);
    try {
      await fileService.deleteProjectData(id);
    } catch (error) {
      console.warn('[删除项目] 清理持久化数据失败:', error);
      get().showToast('项目删除失败，本地数据未清理', 'error');
      return;
    }
    const deletedConversationIds = new Set([
      ...state.conversations
        .filter((conversation) => conversation.projectId === id)
        .map((conversation) => conversation.id),
      ...state.agentTasks
        .filter((task) => task.projectId === id)
        .map((task) => task.conversationId),
    ]);
    for (const conversationId of deletedConversationIds) {
      clearConversationFileGrants(conversationId);
    }
    const retainedChatState = {
      conversations: state.conversations.filter((conversation) => conversation.projectId !== id),
      messages: state.messages.filter((message) => !deletedConversationIds.has(message.conversationId)),
      activeConversationId: state.activeConversationId
        && deletedConversationIds.has(state.activeConversationId)
        ? null
        : state.activeConversationId,
    };

    if (isCurrent && filtered.length === 1 && filtered[0]?.id === 'default') {
      const newId = generateProjectId();
      const now = Date.now();
      const newFolder = fileService.buildProjectFolderName('默认画布', newId);
      fileService.registerProjectFolder(newId, newFolder);
      set({
        projects: [{ id: newId, name: '默认画布', createdAt: now, updatedAt: now, dataFolder: newFolder }],
        currentProjectId: newId,
        projectName: '默认画布',
        projectLoadStatus: 'ready',
        nodes: [],
        edges: [],
        history: [],
        historyIndex: -1,
        dramaAssets: { version: 2 as const, characters: [], scenes: [], props: [] },
        operationLogs: [],
        ...retainedChatState,
      });
      fileService.saveProject({ id: newId, name: '默认画布', createdAt: now, updatedAt: now, dataFolder: newFolder, nodes: [], edges: [] }).catch((e) => console.warn('[重建默认项目] 保存失败:', e));
      fileService.ensureProjectDataDir(newId).catch((e) => console.warn('[重建默认项目] 数据目录初始化失败:', e));
      rememberActiveProject(newId);
      setTimeout(() => window.dispatchEvent(new CustomEvent('canvas-fit-view')), 0);
    } else {
      const nextId = isCurrent ? filtered[0]?.id ?? null : state.currentProjectId;
      const nextName = isCurrent ? filtered[0]?.name ?? '' : state.projectName;

      set({
        projects: filtered,
        currentProjectId: nextId,
        ...(isCurrent ? { projectLoadStatus: nextId ? 'loading' as const : 'ready' as const } : {}),
        ...retainedChatState,
        ...(isCurrent
          ? {
              projectName: nextName,
              nodes: [],
              edges: [],
              history: [],
              historyIndex: -1,
              dramaAssets: { version: 2 as const, characters: [], scenes: [], props: [] },
              operationLogs: [],
            }
          : {}),
      });

      if (isCurrent && nextId) {
        const data = await fileService.loadProjectData(nextId);
        const { emptyDramaAssetLibrary } = await import('../types/dramaAssets');
        if (hasProjectCanvasData(data)) {
          set({
            nodes: data.nodes as Node<BaseNodeData>[],
            edges: data.edges as Edge[],
            groups: getProjectGroups(data),
            dramaAssets: data.dramaAssets ?? emptyDramaAssetLibrary(),
            projectLoadStatus: 'ready',
          });
          rememberActiveProject(nextId);
          setTimeout(() => window.dispatchEvent(new CustomEvent('canvas-fit-view')), 0);
          get().loadConversationsForProject(nextId).catch((e) => console.warn('[删除项目] 加载会话失败:', e));
          get().repairInterruptedForProject(nextId).catch((e) => console.warn('[删除项目] 修复中断消息失败:', e));
          get().loadAgentTasksForProject(nextId).catch((e) => console.warn('[删除项目] 加载 Agent 任务失败:', e));
          get().loadProjectMemoriesForProject(nextId).catch((e) => console.warn('[删除项目] 加载项目记忆失败:', e));
        } else {
          set({ projectLoadStatus: 'error', dramaAssets: emptyDramaAssetLibrary() });
          get().showToast('替代项目加载失败，已阻止空画布覆盖原数据', 'error');
        }
      }
    }

    get().removeProjectAgentTasks(id);
    get().removeProjectMemories(id);
    fileService.deleteProjectDataDir(id).catch((e) => console.warn('[删除项目] 清理目录失败:', e));
  },

  switchProject: async (id) => {
    if (!get().projects.some((project) => project.id === id)) return;
    const switchSequence = ++projectSwitchSequence;
    const isLatestSwitch = () => switchSequence === projectSwitchSequence;
    const currentProjectId = get().currentProjectId;
    if (currentProjectId && currentProjectId !== id) {
      cancelProjectCanvasDerivations(currentProjectId);
    }
    if (get().projectLoadStatus === 'ready') {
      const snapshotRecord = createCurrentProjectSaveRecord(get());
      void get().captureCurrentProjectSnapshot({
        allowProjectChange: true,
        persistRecord: snapshotRecord,
      });
      await get().saveCurrentProject();
    }
    if (!isLatestSwitch()) return;
    // Clean up undo-trash dirs from the old project before switching
    await fileService.flushUndoTrashDirs();
    if (!isLatestSwitch()) return;

    const project = get().projects.find((p) => p.id === id);
    if (!project) return;

    fileService.ensureProjectDataDir(id).catch((e) => console.warn('[切换项目] 数据目录初始化失败:', e));

    const data = await fileService.loadProjectData(id);
    if (!isLatestSwitch()) return;
    const { emptyDramaAssetLibrary } = await import('../types/dramaAssets');
    if (!isLatestSwitch()) return;
    if (!hasProjectCanvasData(data)) {
      get().showToast('项目加载失败，已保留当前画布并阻止覆盖保存', 'error');
      return;
    }
    set({
      currentProjectId: id,
      projectName: project.name,
      projectLoadStatus: 'ready',
      nodes: data.nodes as Node<BaseNodeData>[],
      edges: data.edges as Edge[],
      groups: getProjectGroups(data),
      history: [],
      historyIndex: -1,
      dramaAssets: data.dramaAssets ?? emptyDramaAssetLibrary(),
    });
    rememberActiveProject(id);
    // 恢复当前项目的待续轮询任务
    resumePendingTasks(id).catch((e) => console.warn('[切换项目] 恢复待续任务失败:', e));
    // 加载聊天会话
    get().loadConversationsForProject(id).catch((e) => console.warn('[切换项目] 加载会话失败:', e));
    get().repairInterruptedForProject(id).catch((e) => console.warn('[切换项目] 修复中断消息失败:', e));
    // 项目切换只加载任务，不把应用运行期间的后台任务误判为中断。
    get().loadAgentTasksForProject(id).catch((e) => console.warn('[切换项目] 加载 Agent 任务失败:', e));
    get().loadProjectMemoriesForProject(id).catch((e) => console.warn('[切换项目] 加载项目记忆失败:', e));

    setTimeout(() => window.dispatchEvent(new CustomEvent('canvas-fit-view')), 0);
  },

  saveCurrentProject: async () => {
    const state = get();
    if (state.currentProjectId && state.projectLoadStatus !== 'ready') {
      state.showToast('项目尚未成功加载，已阻止覆盖保存', 'error');
      return undefined;
    }
    const record = createCurrentProjectSaveRecord(state);
    if (!record) return undefined;
    try {
      await enqueueProjectSave(record);
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === record.id ? { ...p, updatedAt: record.updatedAt, name: record.name } : p
        ),
      }));
      get().showToast('项目已保存');
      return record.id;
    } catch (error) {
      console.error('Save failed:', error);
      get().showToast('保存失败', 'error');
      return undefined;
    }
  },

  /** 静默保存（不弹 toast），用于自动保存 */
  saveCurrentProjectSilent: async () => {
    const state = get();
    if (state.currentProjectId && state.projectLoadStatus !== 'ready') {
      if (state.projectLoadStatus === 'error' && !state._autoSaveFailedNotified) {
        state.showToast('项目加载失败，已阻止空画布覆盖原数据', 'error');
        set({ _autoSaveFailedNotified: true });
      }
      return undefined;
    }
    const record = createCurrentProjectSaveRecord(state);
    if (!record) return undefined;
    try {
      await enqueueProjectSave(record);
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === record.id ? { ...p, updatedAt: record.updatedAt, name: record.name } : p
        ),
      }));
      // 成功后重置失败通知标志
      set({ _autoSaveFailedNotified: false });
      return record.id;
    } catch (error) {
      console.warn('[自动保存] 保存失败:', error);
      // 首次失败才弹 toast，避免每 2 秒刷屏
      if (!get()._autoSaveFailedNotified) {
        get().showToast('自动保存失败，请手动保存 (Ctrl+S)', 'error');
        set({ _autoSaveFailedNotified: true });
      }
      return undefined;
    }
  },

  loadProject: async () => {
    try {
      const allProjects = await fileService.loadProjectsList();
      if (allProjects.length > 0) {
        const mapped: CanvasProject[] = allProjects.map((p) => ({
          id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt,
          snapshot: p.snapshot, dataFolder: p.dataFolder, settings: p.settings,
        }));
        fileService.registerProjectFolders(mapped);
        const current = get().currentProjectId;
        const exists = mapped.find((p) => p.id === current);
        const targetId = exists ? current : mapped[0].id;
        set({ projects: mapped, projectLoadStatus: 'loading' });

        const data = await fileService.loadProjectData(targetId!);
        if (hasProjectCanvasData(data)) {
          const { emptyDramaAssetLibrary } = await import('../types/dramaAssets');
          set({
            currentProjectId: targetId!,
            projectName: data.name || '已加载项目',
            nodes: data.nodes as Node<BaseNodeData>[],
            edges: data.edges as Edge[],
            groups: getProjectGroups(data),
            history: [],
            historyIndex: -1,
            dramaAssets: data.dramaAssets ?? emptyDramaAssetLibrary(),
            projectLoadStatus: 'ready',
          });
          rememberActiveProject(targetId!);
        } else {
          set({ currentProjectId: null, projectLoadStatus: 'error' });
          get().showToast('项目加载失败，已阻止空画布覆盖原数据', 'error');
          return;
        }
        // 恢复待续轮询任务
        resumePendingTasks(targetId!).catch((e) => console.warn('[加载项目] 恢复待续任务失败:', e));
      }
    } catch (error) {
      console.error('Load failed:', error);
      set({ currentProjectId: null, projectLoadStatus: 'error' });
      get().showToast('项目列表读取失败，未创建空项目', 'error');
    }
  },

  initFromDb: async () => {
    try {
      await Promise.all([get().loadConfig(), get().loadWorkflows(), get().loadPresets(), get().loadSkills(), get().loadCustomStyles(), get().loadToolbarLayouts()]);

      const allProjects = await fileService.loadProjectsList();
      const valid = allProjects.filter((p) => p.id !== 'default');
      if (valid.length < allProjects.length) {
        fileService.deleteProjectData('default').catch((e) => console.warn('[初始化] 清理默认项目数据失败:', e));
      }
      let activeProjectId: string | null = null;
      if (valid.length > 0) {
        const mapped: CanvasProject[] = valid.map((p) => ({
          id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt,
          snapshot: p.snapshot, dataFolder: p.dataFolder, settings: p.settings,
        }));
        fileService.registerProjectFolders(mapped);
        mapped.sort((a, b) => b.updatedAt - a.updatedAt);
        const rememberedProjectId = await getLastActiveProjectId().catch(() => null);
        const targetId = rememberedProjectId
          && mapped.some((project) => project.id === rememberedProjectId)
          ? rememberedProjectId
          : mapped[0].id;

        const data = await fileService.loadProjectData(targetId);
        const { emptyDramaAssetLibrary } = await import('../types/dramaAssets');
        if (hasProjectCanvasData(data)) {
          activeProjectId = targetId;
          set({
            projects: mapped,
            currentProjectId: targetId,
            projectName: data.name || '新项目',
            nodes: data.nodes as Node<BaseNodeData>[],
            edges: data.edges as Edge[],
            groups: getProjectGroups(data),
            dramaAssets: data.dramaAssets ?? emptyDramaAssetLibrary(),
            projectLoadStatus: 'ready',
          });
          rememberActiveProject(targetId);
        } else {
          set({
            projects: mapped,
            currentProjectId: null,
            projectName: '',
            nodes: [],
            edges: [],
            groups: [],
            dramaAssets: emptyDramaAssetLibrary(),
            projectLoadStatus: 'error',
          });
          get().showToast('项目加载失败，已阻止空画布覆盖原数据', 'error');
        }
        fileService.ensureProjectDataDir(targetId).catch((e) => console.warn('[初始化] 数据目录初始化失败:', e));
      } else {
        const id = generateProjectId();
        activeProjectId = id;
        const now = Date.now();
        const dataFolder = fileService.buildProjectFolderName('默认画布', id);
        fileService.registerProjectFolder(id, dataFolder);
        const defaultProject = { id, name: '默认画布', createdAt: now, updatedAt: now, dataFolder, nodes: [], edges: [] };
        set({
          projects: [{ id, name: '默认画布', createdAt: now, updatedAt: now, dataFolder }],
          currentProjectId: id,
          projectName: '默认画布',
          nodes: [],
          edges: [],
          groups: [],
          projectLoadStatus: 'ready',
        });
        await fileService.saveProject(defaultProject).catch((e) => console.warn('[初始化] 创建默认项目失败:', e));
        fileService.ensureProjectDataDir(id).catch((e) => console.warn('[初始化] 数据目录初始化失败:', e));
        rememberActiveProject(id);
      }
      // 恢复当前项目的待续轮询任务
      if (activeProjectId) {
        resumePendingTasks(activeProjectId).catch((e) => console.warn('[初始化] 恢复待续任务失败:', e));
        // 加载聊天会话
        get().loadConversationsForProject(activeProjectId).catch((e) => console.warn('[初始化] 加载会话失败:', e));
        get().repairInterruptedForProject(activeProjectId).catch((e) => console.warn('[初始化] 修复中断消息失败:', e));
        get().loadProjectMemoriesForProject(activeProjectId).catch((e) => console.warn('[初始化] 加载项目记忆失败:', e));
        // 应用重启后，所有项目的未完成 Agent 任务都必须恢复为暂停，禁止自动续跑。
        const projectIds = get().projects.map((project) => project.id);
        await Promise.all(projectIds.map((projectId) =>
          get().repairInterruptedAgentTasksForProject(projectId),
        ));
      }
    } catch (error) {
      console.error('Init from IndexedDB failed:', error);
      set({ currentProjectId: null, projectLoadStatus: 'error' });
      get().showToast('项目数据读取失败，未创建空项目', 'error');
    }
  },
});
