import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAssistantSystemPrompt,
  resolveAssistantModel,
  streamAssistantReply,
} from '../../src/services/ai/assistantStream';
import { runAssistantPipeline } from '../../src/services/chat/assistantService';
import { useAppStore } from '../../src/store/useAppStore';
import type { ModelExecutionProfile } from '../../src/types/aiTypes';
import type { UserSkill } from '../../src/types';

const configureAssistant = (executionProfile: ModelExecutionProfile) => {
  useAppStore.setState((state) => ({
    config: {
      ...state.config,
      assistantModelId: 'assistant-model',
      providers: {
        ...state.config.providers,
        'custom-assistant': {
          name: '自定义助手连接',
          apiKey: 'secret',
          baseUrl: 'https://gateway.example/v1',
          catalogId: 'custom-openai',
        },
      },
      generalModels: [{
        id: 'assistant-model',
        name: '自定义助手',
        modelId: 'vendor-chat',
        category: 'text',
        providerConfigId: 'custom-assistant',
        executionProfile,
      }],
    },
  }));
};

beforeEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe('assistant custom protocol boundary', () => {
  it('resolves a configured built-in provider text model selected by model value', () => {
    useAppStore.setState((state) => ({
      config: {
        ...state.config,
        assistantModelId: 'apimart/gpt-5.4',
        providers: {
          ...state.config.providers,
          apimart: {
            name: 'APIMart',
            apiKey: 'secret',
            catalogId: 'apimart',
            selectedModels: [{
              id: 'gpt-5.4',
              name: 'GPT-5.4',
              category: 'text',
              provider: 'apimart',
            }],
          },
        },
      },
    }));

    expect(resolveAssistantModel()).toMatchObject({
      baseUrl: 'https://api.apib.ai/v1',
      apiKey: 'secret',
      modelName: 'gpt-5.4',
      protocol: { streamFormat: 'openai-sse' },
    });
  });

  it('returns an explicit model-selection message instead of generic canvas help', async () => {
    const result = await runAssistantPipeline('帮我分析这个接口文档', 'conversation-1');

    expect(result.reply).toContain('未选择可用的对话文本模型');
    expect(result.reply).not.toContain('当前画布共有');
  });

  it('uses an explicitly OpenAI SSE compatible custom endpoint', async () => {
    configureAssistant({
      preset: 'custom',
      protocol: {
        version: 1,
        mode: 'sync',
        streamFormat: 'openai-sse',
        submit: {
          method: 'POST',
          path: '/chat/',
          body: {
            model: '{{model}}',
            messages: '{{messages}}',
            stream: '{{stream}}',
            tools: '{{tools}}',
            tool_choice: '{{toolChoice}}',
          },
        },
        resultTextPath: 'choices.0.message.content',
      },
    } as unknown as ModelExecutionProfile);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: '完成' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await streamAssistantReply({
      systemPrompt: '系统',
      userMessage: '你好',
      nonStream: true,
      onEvent: vi.fn(),
    });

    expect(result).toBe('完成');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://gateway.example/v1/chat/');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'vendor-chat',
      messages: [
        { role: 'system', content: '系统' },
        { role: 'user', content: '你好' },
      ],
      stream: false,
    });
  });

  it('uses the current provider credential after key rotation', () => {
    configureAssistant({ preset: 'openai-chat' });
    useAppStore.getState().setProviderKey('custom-assistant', 'rotated-secret');

    expect(resolveAssistantModel()).toMatchObject({
      apiKey: 'rotated-secret',
      baseUrl: 'https://gateway.example/v1',
      modelName: 'vendor-chat',
    });
  });

  it('rejects a custom text protocol that does not declare OpenAI SSE compatibility', async () => {
    configureAssistant({
      preset: 'custom',
      protocol: {
        version: 1,
        mode: 'sync',
        submit: { method: 'POST', path: '/respond', body: { prompt: '{{prompt}}' } },
        resultTextPath: 'answer',
      },
    } as unknown as ModelExecutionProfile);

    await expect(streamAssistantReply({
      systemPrompt: '',
      userMessage: '你好',
      nonStream: true,
      onEvent: vi.fn(),
    })).rejects.toThrow('OpenAI SSE');
  });
});

describe('buildAssistantSystemPrompt 的 Skill 索引', () => {
  const skill = (partial: Partial<UserSkill> = {}): UserSkill => ({
    id: 'skill-1',
    name: 'Canvas audit',
    description: 'Audit the canvas',
    fileName: 'SKILL.md',
    content: 'Review the canvas.',
    sourceType: 'file',
    createdAt: 1,
    ...partial,
  });

  it('没有可见 Skill 时不产生空的索引段', () => {
    useAppStore.setState({ userSkills: [] });
    const prompt = buildAssistantSystemPrompt({ agentTools: true });
    expect(prompt).not.toContain('可用 Skill');
  });

  it('注入索引与不可信边界说明，并给出 skill_load 使用规则', () => {
    useAppStore.setState({
      userSkills: [skill({ manifest: { whenToUse: '发布工作流之前使用' } })],
    });
    const prompt = buildAssistantSystemPrompt({ agentTools: true });
    expect(prompt).toContain('可用 Skill');
    expect(prompt).toContain('skillId: skill-1');
    expect(prompt).toContain('发布工作流之前使用');
    expect(prompt).toContain('skill_load');
    expect(prompt).toContain('不可信');
    expect(prompt).toContain('主动加载不会改变本次任务的工具权限');
  });

  it('disable-model-invocation 的 Skill 名称不出现在系统提示词中', () => {
    useAppStore.setState({
      userSkills: [skill({ name: '内部审计流程', manifest: { disableModelInvocation: true } })],
    });
    const prompt = buildAssistantSystemPrompt({ agentTools: true });
    expect(prompt).not.toContain('内部审计流程');
    expect(prompt).not.toContain('可用 Skill');
  });

  it('旧命令分支不注入 Skill 索引', () => {
    useAppStore.setState({ userSkills: [skill()] });
    expect(buildAssistantSystemPrompt()).not.toContain('可用 Skill');
  });
});

describe('buildAssistantSystemPrompt 的厂商配置审批时序', () => {
  it('要求草稿生成后立即发起本地审批，不等待用户再发一条确认消息', () => {
    const prompt = buildAssistantSystemPrompt({ agentTools: true });

    expect(prompt).toContain('必须在同一 Agent 任务中立即调用 provider_config_apply');
    expect(prompt).toContain('本地 Policy 自动暂停并展示 API 配置审批卡');
    expect(prompt).toContain('不要先用普通文本要求用户回复“确认/添加”');
    expect(prompt).not.toContain('只有用户确认后才能调用 provider_config_apply');
  });
});
