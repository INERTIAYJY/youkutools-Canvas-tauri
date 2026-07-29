/**
 * Sub-agent slice — 用户可配置的只读领域子智能体。
 *
 * 内置典范不落库，只在读取时与用户配置合并；删除或编辑内置典范一律被拒绝。
 */
import type { StateCreator } from 'zustand';
import type { AppState } from './useAppStore';
import type { SubAgentProfile, SubAgentProfileDraft } from '../types/subAgent';
import { generateId } from './store.utils';
import {
  deleteSubAgentProfileFromDb,
  getAllSubAgentProfiles,
  saveSubAgentProfileToDb,
} from '../services/indexedDbService';
import {
  isBuiltInSubAgentProfileId,
  mergeSubAgentProfiles,
  normalizeStoredSubAgentProfile,
  normalizeSubAgentDraft,
  SubAgentProfileError,
} from '../services/chat/subAgentProfileService';

export interface SubAgentSlice {
  /** 只保存用户自定义配置；内置典范由 listSubAgentProfiles 合并。 */
  subAgentProfiles: SubAgentProfile[];
  listSubAgentProfiles: () => SubAgentProfile[];
  createSubAgentProfile: (draft: SubAgentProfileDraft) => Promise<SubAgentProfile>;
  updateSubAgentProfile: (id: string, draft: SubAgentProfileDraft) => Promise<SubAgentProfile>;
  deleteSubAgentProfile: (id: string) => Promise<void>;
  loadSubAgentProfiles: () => Promise<void>;
}

export const createSubAgentSlice: StateCreator<AppState, [], [], SubAgentSlice> = (set, get) => ({
  subAgentProfiles: [],

  listSubAgentProfiles: () => mergeSubAgentProfiles(get().subAgentProfiles),

  createSubAgentProfile: async (draft) => {
    const normalized = normalizeSubAgentDraft(draft);
    const now = Date.now();
    const profile: SubAgentProfile = {
      ...normalized,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ subAgentProfiles: [...state.subAgentProfiles, profile] }));
    await saveSubAgentProfileToDb({ ...profile })
      .catch((e) => console.warn('[子智能体] 持久化失败:', e));
    return profile;
  },

  updateSubAgentProfile: async (id, draft) => {
    if (isBuiltInSubAgentProfileId(id)) {
      throw new SubAgentProfileError('SUB_AGENT_BUILT_IN_READONLY', '内置子智能体不可编辑，请复制为副本');
    }
    const existing = get().subAgentProfiles.find((item) => item.id === id);
    if (!existing) {
      throw new SubAgentProfileError('SUB_AGENT_NOT_FOUND', '找不到该子智能体配置');
    }
    const normalized = normalizeSubAgentDraft(draft);
    const profile: SubAgentProfile = { ...existing, ...normalized, updatedAt: Date.now() };
    set((state) => ({
      subAgentProfiles: state.subAgentProfiles.map((item) => (item.id === id ? profile : item)),
    }));
    await saveSubAgentProfileToDb({ ...profile })
      .catch((e) => console.warn('[子智能体] 持久化失败:', e));
    return profile;
  },

  deleteSubAgentProfile: async (id) => {
    if (isBuiltInSubAgentProfileId(id)) {
      throw new SubAgentProfileError('SUB_AGENT_BUILT_IN_READONLY', '内置子智能体不可删除');
    }
    set((state) => ({
      subAgentProfiles: state.subAgentProfiles.filter((item) => item.id !== id),
    }));
    await deleteSubAgentProfileFromDb(id)
      .catch((e) => console.warn('[子智能体] 清理失败:', e));
  },

  loadSubAgentProfiles: async () => {
    const records = await getAllSubAgentProfiles().catch((e) => {
      console.warn('[子智能体] 读取失败:', e);
      return [];
    });
    const profiles = records
      .map((record) => normalizeStoredSubAgentProfile({
        ...record,
        materials: record.materials as SubAgentProfile['materials'],
      }))
      .filter((profile): profile is SubAgentProfile => profile !== null);
    set({ subAgentProfiles: profiles });
  },
});
