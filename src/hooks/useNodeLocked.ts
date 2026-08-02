/**
 * useNodeLocked — 读取节点的锁定状态。
 *
 * 锁定由右键菜单的「锁定」写入 node.draggable = false，
 * 除了禁止拖拽移动，也要禁止缩放改变大小。
 */
import { useAppStore } from '../store/useAppStore';

export function useNodeLocked(nodeId?: string): boolean {
  return useAppStore((s) =>
    !!nodeId && s.nodes.find((n) => n.id === nodeId)?.draggable === false);
}
