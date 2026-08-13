import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatConversation, ChatMessage } from '../../src/types/chat';

const historyMocks = vi.hoisted(() => ({
  saveConversation: vi.fn(async () => undefined),
  softDeleteConversation: vi.fn(async (conversation: ChatConversation) => conversation),
  loadProjectConversations: vi.fn<() => Promise<ChatConversation[]>>(),
  loadMessages: vi.fn<() => Promise<{ messages: ChatMessage[]; total: number }>>(),
  persistMessage: vi.fn(async () => undefined),
  clearConversationMessages: vi.fn(async () => undefined),
  repairInterruptedMessages: vi.fn(async () => [] as string[]),
}));

vi.mock('../../src/services/chat/chatHistoryService', () => historyMocks);

import { useAppStore } from '../../src/store/useAppStore';

const storageValues = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storageValues.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storageValues.set(key, value)),
  removeItem: vi.fn((key: string) => storageValues.delete(key)),
  clear: vi.fn(() => storageValues.clear()),
  key: vi.fn((index: number) => [...storageValues.keys()][index] ?? null),
  get length() {
    return storageValues.size;
  },
} satisfies Storage;

function conversation(id: string, updatedAt: number): ChatConversation {
  return {
    id,
    projectId: 'project-1',
    title: id,
    titleSource: 'auto',
    pinned: false,
    archived: false,
    agentMode: 'collaborative',
    createdAt: updatedAt,
    updatedAt,
    messageCount: 1,
  };
}

function message(id: string, conversationId: string): ChatMessage {
  return {
    id,
    conversationId,
    role: 'assistant',
    content: id,
    timestamp: 1,
    status: 'done',
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageMock);
  storageValues.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ currentProjectId: 'project-1' });
  historyMocks.loadProjectConversations.mockReset();
  historyMocks.loadMessages.mockReset();
});

describe('chat conversation restoration', () => {
  it('restores the selected conversation and loads its messages after restart', async () => {
    const conversations = [conversation('conversation-newest', 2), conversation('conversation-selected', 1)];
    useAppStore.setState({ conversations });
    useAppStore.getState().setActiveConversation('conversation-selected');

    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({ currentProjectId: 'project-1' });
    historyMocks.loadProjectConversations.mockResolvedValue(conversations);
    historyMocks.loadMessages.mockResolvedValue({
      messages: [message('restored-message', 'conversation-selected')],
      total: 1,
    });

    await useAppStore.getState().loadConversationsForProject('project-1');

    expect(useAppStore.getState().activeConversationId).toBe('conversation-selected');
    expect(useAppStore.getState().messages.map((item) => item.id)).toEqual(['restored-message']);
    expect(historyMocks.loadMessages).toHaveBeenCalledWith('conversation-selected', 0, 200);
  });

  it('scopes an episode to its series owner for load and create', async () => {
    // series-1 是剧集，ep-2 是它的分集（parentId 指向 series-1）
    useAppStore.setState({
      projects: [
        { id: 'series-1', name: 'S', createdAt: 1, updatedAt: 1 },
        { id: 'ep-2', name: 'E2', createdAt: 1, updatedAt: 1, parentId: 'series-1', episodeNo: 2 },
      ],
      currentProjectId: 'ep-2',
    });
    historyMocks.loadProjectConversations.mockResolvedValue([]);
    historyMocks.loadMessages.mockResolvedValue({ messages: [], total: 0 });

    await useAppStore.getState().loadConversationsForProject('ep-2');
    expect(historyMocks.loadProjectConversations).toHaveBeenCalledWith('series-1');

    const id = useAppStore.getState().createConversation('ep-2');
    expect(useAppStore.getState().conversations.find((c) => c.id === id)?.projectId).toBe('series-1');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'ai-canvas.chat.active-conversation:series-1',
      id,
    );
  });

  it('keeps a normal top-level project scoped to itself', async () => {
    useAppStore.setState({
      projects: [{ id: 'project-1', name: 'P', createdAt: 1, updatedAt: 1 }],
      currentProjectId: 'project-1',
    });
    historyMocks.loadProjectConversations.mockResolvedValue([]);
    historyMocks.loadMessages.mockResolvedValue({ messages: [], total: 0 });

    await useAppStore.getState().loadConversationsForProject('project-1');
    expect(historyMocks.loadProjectConversations).toHaveBeenCalledWith('project-1');
    const id = useAppStore.getState().createConversation('project-1');
    expect(useAppStore.getState().conversations.find((c) => c.id === id)?.projectId).toBe('project-1');
  });

  it('falls back to the first available conversation when the saved one no longer exists', async () => {
    localStorageMock.setItem(
      'ai-canvas.chat.active-conversation:project-1',
      'conversation-deleted',
    );
    historyMocks.loadProjectConversations.mockResolvedValue([
      conversation('conversation-fallback', 2),
    ]);
    historyMocks.loadMessages.mockResolvedValue({ messages: [], total: 0 });

    await useAppStore.getState().loadConversationsForProject('project-1');

    expect(useAppStore.getState().activeConversationId).toBe('conversation-fallback');
    expect(localStorageMock.setItem).toHaveBeenLastCalledWith(
      'ai-canvas.chat.active-conversation:project-1',
      'conversation-fallback',
    );
  });
});
