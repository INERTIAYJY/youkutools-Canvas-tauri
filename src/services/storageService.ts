/**
 * storageService — IndexedDB-backed persistence wrappers for projects,
 * workflows, app config, user presets, and uploaded skills.
 */
import {
  saveProjectToDb,
  getAllProjects,
  getProjectById,
  deleteProjectFromDb,
  saveWorkflowToDb,
  getAllWorkflows,
  deleteWorkflowFromDb,
  saveConfigToDb,
  loadConfigFromDb,
  savePresetToDb,
  getAllPresets,
  deletePresetFromDb,
  saveSkillToDb,
  getAllSkills,
  deleteSkillFromDb,
  saveStyleToDb,
  getAllStyles,
  deleteStyleFromDb,
  saveToolbarLayoutsToDb,
  loadToolbarLayoutsFromDb,
  type WorkflowRecord,
  type PresetRecord,
  type SkillRecord,
  type CustomStyleRecord,
} from './indexedDbService';
import { exists } from '@tauri-apps/plugin-fs';
import type { BaseNodeData, ProjectSettings, StoryboardCellOverride } from '../types';
import { getAssetUrlFromPath, getProjectDataDir, joinPath } from './fs/core';
import { walkDirectoryFiles } from './fs/assetLibrary';
import { identifyAsset, resolveIndexedAssetPath } from './fs/assetIndex';
import { normalizeDramaAssetLibrary } from '../types/dramaAssets';
import { restoreConfigSecrets, stripConfigSecrets } from './providerSecretService';

interface PersistedNodeLike {
  data?: BaseNodeData;
  [key: string]: unknown;
}

async function serializeAssetReference(
  data: BaseNodeData | StoryboardCellOverride,
  projectId: string,
  projectDir: string,
): Promise<BaseNodeData | StoryboardCellOverride> {
  if (!data.filePath) return data;
  const normalizedPath = data.filePath.replace(/\\/g, '/');
  const normalizedDir = projectDir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedPath.toLowerCase().startsWith(`${normalizedDir.toLowerCase()}/`)) return data;

  // 文件可能已被外部删除/移动：identifyAsset 会 stat 失败抛错，
  // 不拦住的话整个项目保存都会失败（下次加载再按 assetId 重新识别）
  const identity = await identifyAsset(normalizedPath, {
    assetId: data.assetId,
    rootPath: normalizedDir,
    projectId,
    source: 'project',
  }).catch(() => null);
  if (!identity) return data;
  const serialized = { ...data, assetId: identity.assetId, relativePath: identity.relativePath };
  delete serialized.filePath;
  return serialized;
}

async function serializeProjectNodes(nodes: unknown, projectId: string): Promise<unknown> {
  if (!Array.isArray(nodes)) return nodes;
  const projectDir = await getProjectDataDir(projectId);
  if (!projectDir) return nodes;
  return Promise.all((nodes as PersistedNodeLike[]).map(async (node) => {
    if (!node.data) return node;
    let data = await serializeAssetReference(node.data, projectId, projectDir) as BaseNodeData;
    if (Array.isArray(data.storyboardOverrides)) {
      const storyboardOverrides = await Promise.all(data.storyboardOverrides.map(async (override) => (
        override ? serializeAssetReference(override, projectId, projectDir) as Promise<StoryboardCellOverride> : null
      )));
      data = { ...data, storyboardOverrides };
    }
    return { ...node, data };
  }));
}

async function restoreAssetReference<T extends BaseNodeData | StoryboardCellOverride>(
  data: T,
  projectId: string,
  projectDir: string,
): Promise<T> {
  let filePath = data.relativePath ? joinPath(projectDir, data.relativePath) : data.filePath;
  if (filePath && !(await exists(filePath).catch(() => false))) filePath = undefined;
  if (!filePath && data.assetId) filePath = await resolveIndexedAssetPath(data.assetId) ?? undefined;
  if (!filePath) return data;

  const identity = await identifyAsset(filePath, {
    assetId: data.assetId,
    rootPath: projectDir,
    projectId,
    source: 'project',
  });
  const restored = { ...data, assetId: identity.assetId, relativePath: identity.relativePath, filePath } as T;
  const previousDiskName = (data.relativePath ?? data.filePath)?.split(/[/\\]/).pop();
  const currentDiskName = filePath.split(/[/\\]/).pop();
  if ('label' in restored && previousDiskName && currentDiskName && previousDiskName !== currentDiskName) {
    const previousFileName = restored.fileName;
    const previousLabel = restored.label;
    const stem = (name: string) => name.replace(/\.[^.]+$/, '');
    restored.fileName = currentDiskName;
    if (
      previousLabel === previousFileName
      || previousLabel === previousDiskName
      || stem(previousLabel) === stem(previousDiskName)
    ) {
      restored.label = currentDiskName;
    }
  }
  if ('imageUrl' in restored && restored.imageUrl) restored.imageUrl = await getAssetUrlFromPath(filePath);
  if ('videoUrl' in restored && restored.videoUrl) restored.videoUrl = await getAssetUrlFromPath(filePath);
  if ('audioUrl' in restored && restored.audioUrl) restored.audioUrl = await getAssetUrlFromPath(filePath);
  if ('url' in restored) restored.url = await getAssetUrlFromPath(filePath);
  return restored;
}

async function restoreProjectNodes(nodes: unknown, projectId: string): Promise<unknown> {
  if (!Array.isArray(nodes)) return nodes;
  const projectDir = await getProjectDataDir(projectId);
  if (!projectDir) return nodes;
  // 先刷新项目目录索引（含分组子文件夹），使外部重命名/移动后的文件能在按 assetId 恢复节点前被重新识别。
  const diskFiles = await walkDirectoryFiles(projectDir);
  await Promise.all(diskFiles.map((file) => identifyAsset(file.path, {
    rootPath: projectDir,
    projectId,
    source: 'project',
    size: file.size,
  })));
  return Promise.all((nodes as PersistedNodeLike[]).map(async (node) => {
    if (!node.data) return node;
    let data = await restoreAssetReference(node.data, projectId, projectDir);
    if (Array.isArray(data.storyboardOverrides)) {
      const storyboardOverrides = await Promise.all(data.storyboardOverrides.map(async (override) => (
        override ? restoreAssetReference(override, projectId, projectDir) : null
      )));
      data = { ...data, storyboardOverrides };
    }
    return { ...node, data };
  }));
}

export interface ProjectSaveData {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  snapshot?: string;
  nodes: unknown;
  edges: unknown;
  groups?: unknown;
  /** 本地媒体文件夹名（形如「项目名-短ID」），创建时确定后保持稳定 */
  dataFolder?: string;
  settings?: ProjectSettings;
  /** 短剧资产库（人物/场景/道具简介） */
  dramaAssets?: import('../types/dramaAssets').DramaAssetLibrary;
}

/** 保存项目到 IndexedDB */
export async function saveProject(data: ProjectSaveData): Promise<string> {
  try {
    await saveProjectToDb({ ...data, nodes: await serializeProjectNodes(data.nodes, data.id) });
    console.log('Project saved to IndexedDB:', data.id);
    return data.id;
  } catch (error) {
    console.error('Save project to IndexedDB failed:', error);
    throw error;
  }
}

/** 从 IndexedDB 加载所有项目元数据 */
export async function loadProjectsList(): Promise<ProjectSaveData[]> {
  try {
    return await getAllProjects();
  } catch (error) {
    console.error('Load projects list failed:', error);
    return [];
  }
}

/** 从 IndexedDB 加载单个项目完整数据 */
export async function loadProjectData(id: string): Promise<ProjectSaveData | null> {
  try {
    const record = await getProjectById(id);
    if (!record) return null;
    return {
      ...record,
      nodes: await restoreProjectNodes(record.nodes, id),
      dramaAssets: normalizeDramaAssetLibrary(
        (record as ProjectSaveData).dramaAssets,
      ),
    } as ProjectSaveData;
  } catch (error) {
    console.error('Load project data failed:', error);
    return null;
  }
}

/** 从 IndexedDB 删除项目 */
export async function deleteProjectData(id: string): Promise<void> {
  try {
    await deleteProjectFromDb(id);
    console.log('Project deleted from IndexedDB:', id);
  } catch (error) {
    console.error('Delete project from IndexedDB failed:', error);
    throw error;
  }
}

export async function saveWorkflow(record: WorkflowRecord): Promise<void> {
  try {
    await saveWorkflowToDb(record);
    console.log('Workflow saved to IndexedDB:', record.id);
  } catch (error) {
    console.error('Save workflow failed:', error);
    throw error;
  }
}

export async function loadWorkflows(): Promise<WorkflowRecord[]> {
  try {
    return await getAllWorkflows();
  } catch (error) {
    console.error('Load workflows failed:', error);
    return [];
  }
}

export async function deleteWorkflow(id: string): Promise<void> {
  try {
    await deleteWorkflowFromDb(id);
    console.log('Workflow deleted from IndexedDB:', id);
  } catch (error) {
    console.error('Delete workflow failed:', error);
    throw error;
  }
}

/**
 * 保存应用配置到 IndexedDB。
 * 凭据先摘进 Rust 侧凭据存储，数据库里只留引用；存储失败也不落明文。
 * @returns 未能写入凭据存储、仅本次会话有效的连接 ID
 */
export async function saveConfig(data: unknown): Promise<string[]> {
  try {
    const { config, unstored } = await stripConfigSecrets(data);
    await saveConfigToDb(config);
    console.log('Config saved to IndexedDB');
    return unstored;
  } catch (error) {
    console.error('Save config failed:', error);
    throw error;
  }
}

export interface LoadedConfig {
  config: unknown | null;
  /** 引用存在但凭据存储里读不到的连接 ID，需要用户重新输入 */
  missingSecrets: string[];
}

/**
 * 从 IndexedDB 加载应用配置，并按引用从凭据存储补回凭据。
 * 遇到旧版明文配置会迁进凭据存储并立刻回写清理后的记录。
 */
export async function loadConfigWithSecrets(): Promise<LoadedConfig> {
  try {
    const raw = await loadConfigFromDb();
    if (raw === null || raw === undefined) return { config: null, missingSecrets: [] };

    const { config, migrated, missing } = await restoreConfigSecrets(raw);
    if (migrated) {
      // 明文已进凭据存储，立刻覆盖掉数据库里的旧记录
      const { config: scrubbed } = await stripConfigSecrets(config);
      await saveConfigToDb(scrubbed);
      console.log('[storage] 已将明文 API Key 迁移到凭据存储并清理数据库记录');
    }
    return { config, missingSecrets: missing };
  } catch (error) {
    console.error('Load config failed:', error);
    return { config: null, missingSecrets: [] };
  }
}

/** 从 IndexedDB 加载应用配置（凭据已补回）。 */
export async function loadConfig(): Promise<unknown | null> {
  return (await loadConfigWithSecrets()).config;
}

/**
 * 只读取配置本体，不触碰凭据存储。
 * 供只关心主题、窗口尺寸这类非凭据字段的早期启动路径使用，省掉无谓的凭据读取。
 */
export async function loadConfigWithoutSecrets(): Promise<unknown | null> {
  try {
    return await loadConfigFromDb();
  } catch (error) {
    console.error('Load config failed:', error);
    return null;
  }
}

export async function savePreset(record: PresetRecord): Promise<void> {
  try {
    await savePresetToDb(record);
    console.log('Preset saved to IndexedDB:', record.id);
  } catch (error) {
    console.error('Save preset failed:', error);
    throw error;
  }
}

export async function loadPresets(): Promise<PresetRecord[]> {
  try {
    return await getAllPresets();
  } catch (error) {
    console.error('Load presets failed:', error);
    return [];
  }
}

export async function deletePreset(id: string): Promise<void> {
  try {
    await deletePresetFromDb(id);
    console.log('Preset deleted from IndexedDB:', id);
  } catch (error) {
    console.error('Delete preset failed:', error);
    throw error;
  }
}

// ── Uploaded Skills ──

export async function saveSkill(record: SkillRecord): Promise<void> {
  try {
    await saveSkillToDb(record);
    console.log('Skill saved to IndexedDB:', record.id);
  } catch (error) {
    console.error('Save skill failed:', error);
    throw error;
  }
}

export async function loadSkills(): Promise<SkillRecord[]> {
  try {
    return await getAllSkills();
  } catch (error) {
    console.error('Load skills failed:', error);
    return [];
  }
}

export async function deleteSkill(id: string): Promise<void> {
  try {
    await deleteSkillFromDb(id);
    console.log('Skill deleted from IndexedDB:', id);
  } catch (error) {
    console.error('Delete skill failed:', error);
    throw error;
  }
}

// ── Custom Styles ──

export async function saveStyle(record: CustomStyleRecord): Promise<void> {
  try {
    await saveStyleToDb(record);
  } catch (error) {
    console.error('Save style failed:', error);
    throw error;
  }
}

export async function loadStyles(): Promise<CustomStyleRecord[]> {
  try {
    return await getAllStyles();
  } catch (error) {
    console.error('Load styles failed:', error);
    return [];
  }
}

export async function deleteStyle(id: string): Promise<void> {
  try {
    await deleteStyleFromDb(id);
  } catch (error) {
    console.error('Delete style failed:', error);
    throw error;
  }
}

export type { WorkflowRecord, PresetRecord, SkillRecord, CustomStyleRecord };

// ── Toolbar Layouts ──

export async function saveToolbarLayouts(data: Record<string, unknown>): Promise<void> {
  try {
    await saveToolbarLayoutsToDb(data);
  } catch (error) {
    console.error('Save toolbar layouts failed:', error);
    throw error;
  }
}

export async function loadToolbarLayouts(): Promise<Record<string, unknown> | null> {
  try {
    return await loadToolbarLayoutsFromDb();
  } catch (error) {
    console.error('Load toolbar layouts failed:', error);
    return null;
  }
}
