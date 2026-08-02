/**
 * fs/trash — 文件/目录删除域
 * 系统回收站、项目级 .trash 暂存（支持撤销）、项目数据目录删除、节点文件删除。
 */
import { mkdir, exists, remove, rename } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv, joinPath, notifyProjectDiskChanged, getProjectDataDir } from './core';

/** 将文件或目录移动到系统回收站（Tauri 端），浏览器环境无操作 */
export async function moveToTrash(filePath: string): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    await invoke('move_to_trash', { path: filePath });
    console.log('[fileService] Moved to trash:', filePath);
  } catch (err) {
    console.warn('[fileService] Failed to move to trash:', filePath, err);
  }
}

// ============================================
// Undo-trash staging (project-level .trash/ dir — restored on undo, flushed to system trash on project delete)
// ============================================

/** Map: originalFilePath → trashFilePath */
const undoTrashMap = new Map<string, string>();

/** 进行中的节点文件删除，撤销前要等它们结束 */
const pendingNodeFileDeletions = new Set<Promise<void>>();

/** Compute the .trash directory for a given file path (same parent dir) */
function getUndoTrashDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSep = normalized.lastIndexOf('/');
  return lastSep >= 0 ? joinPath(normalized.substring(0, lastSep), '.trash') : '.trash';
}

/** Move a file to the project-level .trash staging directory (for undo support) */
export async function moveToUndoTrash(filePath: string): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    const existsFile = await exists(filePath);
    if (!existsFile) return;
    const trashDir = getUndoTrashDir(filePath);
    await mkdir(trashDir, { recursive: true });
    const fileName = filePath.split(/[/\\]/).pop() || 'file';
    const trashPath = joinPath(trashDir, `${Date.now()}-${fileName}`);
    // .trash is a sibling of the source file, so this stays on one filesystem and avoids
    // transferring large media buffers through the WebView just to support undo.
    await rename(filePath, trashPath);
    undoTrashMap.set(filePath, trashPath);
    notifyProjectDiskChanged();
    console.log('[fileService] Staged in undo-trash:', filePath, '→', trashPath);
  } catch (err) {
    // 绝不退回系统回收站：那条路径撤销不回来，节点复活后就成了指向空文件的死节点。
    // 暂存失败时宁可把文件留在原地当孤儿文件，交给存储体检去回收。
    console.warn('[fileService] Failed to stage in undo-trash, file left in place:', filePath, err);
  }
}

/** 文件是否已不在原路径上（仅 Tauri 端有意义），用于撤销后确认媒体是否真的回来了 */
export async function isFileMissing(filePath: string): Promise<boolean> {
  if (!isTauriEnv()) return false;
  try {
    return !(await exists(filePath));
  } catch {
    return false;
  }
}

/** Restore a file from undo-trash staging. Returns true on success. */
export async function restoreFromUndoTrash(filePath: string): Promise<boolean> {
  if (!isTauriEnv()) return false;
  const trashPath = undoTrashMap.get(filePath);
  if (!trashPath) return false;
  try {
    const trashExists = await exists(trashPath);
    if (!trashExists) { undoTrashMap.delete(filePath); return false; }
    await rename(trashPath, filePath);
    undoTrashMap.delete(filePath);
    notifyProjectDiskChanged();
    console.log('[fileService] Restored from undo-trash:', filePath);
    return true;
  } catch (err) {
    console.warn('[fileService] Failed to restore from undo-trash:', filePath, err);
    return false;
  }
}

/** Flush all undo-trash files to system recycle bin (called on project delete) */
export async function flushUndoTrashDirs(): Promise<void> {
  if (!isTauriEnv()) return;
  // Collect unique .trash directories
  const trashDirs = new Set<string>();
  for (const [origPath] of undoTrashMap) {
    trashDirs.add(getUndoTrashDir(origPath));
  }
  for (const dir of trashDirs) {
    try {
      if (await exists(dir)) {
        await invoke('move_to_trash', { path: dir });
        console.log('[fileService] Flushed undo-trash dir to system trash:', dir);
      }
    } catch (err) {
      console.warn('[fileService] Failed to flush undo-trash dir:', dir, err);
    }
  }
  undoTrashMap.clear();
}

/** 删除单个文件（Tauri 端），浏览器环境无操作 */
export async function deleteFile(filePath: string): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    await remove(filePath);
    console.log('[fileService] Deleted file:', filePath);
  } catch (err) {
    console.warn('[fileService] Failed to delete file:', filePath, err);
  }
}

/** 将目录移至回收站（Tauri 端），trash crate 本身支持直接移动整个目录 */
async function removeDirRecursive(dirPath: string): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    await invoke('move_to_trash', { path: dirPath });
    console.log('[fileService] Moved dir to trash:', dirPath);
  } catch (err) {
    console.warn('[fileService] Failed to move dir to trash:', dirPath, err);
  }
}

/** 删除项目的本地数据目录（Tauri 端），包括所有媒体文件 */
export async function deleteProjectDataDir(projectId: string): Promise<void> {
  if (!isTauriEnv()) return;
  const dirPath = await getProjectDataDir(projectId);
  if (!dirPath) return;
  try {
    await removeDirRecursive(dirPath);
    console.log('[fileService] Deleted project data dir:', dirPath);
  } catch (err) {
    console.warn('[fileService] Failed to delete project data dir:', dirPath, err);
  }
}

/** 判断路径是否位于某个项目的数据目录内（大小写不敏感，兼容 Windows 反斜杠）。 */
export function isPathInsideDir(filePath: string, dirPath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const normalizedDir = dirPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (!normalizedDir) return false;
  return normalizedPath.startsWith(`${normalizedDir}/`);
}

/**
 * 节点文件是否属于指定项目。
 *
 * 跨项目复制粘贴会让副本的 filePath 仍指向源项目（详见 store.clipboard 的跨项目落地逻辑），
 * 这类路径一旦被当成「本项目的文件」删除，源项目的素材就会被搬进 .trash 并最终进系统废纸篓。
 * 因此删除前必须确认文件确实在本项目目录内。
 */
export async function isProjectOwnedFile(
  filePath: string,
  projectId: string | null,
): Promise<boolean> {
  if (!projectId) return false;
  const projectDir = await getProjectDataDir(projectId).catch(() => null);
  if (!projectDir) return false;
  return isPathInsideDir(filePath, projectDir);
}

/** 尝试删除节点关联的本地文件（如果有 filePath，移入 undo-trash 暂存，撤销时可还原）。
 *  keepPaths：仍被存活节点引用的 filePath 集合 —— 命中则跳过，避免复制节点删除时连累原节点文件。
 *  projectId：当前项目 —— 文件不在该项目目录内时一律不删，避免误删其他项目的素材。 */
export function deleteNodeFile(
  nodeData: { filePath?: string },
  keepPaths?: Set<string>,
  projectId?: string | null,
): Promise<void> {
  const operation = (async () => {
    const fp = nodeData.filePath;
    if (!fp || typeof fp !== 'string' || keepPaths?.has(fp)) return;
    if (projectId !== undefined && !(await isProjectOwnedFile(fp, projectId))) {
      console.warn('[fileService] 跳过删除非本项目文件:', fp);
      return;
    }
    await moveToUndoTrash(fp);
  })();
  // 删除是即发即忘的（节点退场动画不等文件系统），撤销必须能等它落定，
  // 否则还原会跑在暂存前面：节点回来了，文件随后才被搬进 .trash，成了死节点
  pendingNodeFileDeletions.add(operation);
  return operation.finally(() => pendingNodeFileDeletions.delete(operation));
}

/** 等待所有进行中的节点文件删除完成（撤销前调用，避免与暂存竞争） */
export async function waitForPendingNodeFileDeletions(): Promise<void> {
  while (pendingNodeFileDeletions.size > 0) {
    await Promise.allSettled([...pendingNodeFileDeletions]);
  }
}
