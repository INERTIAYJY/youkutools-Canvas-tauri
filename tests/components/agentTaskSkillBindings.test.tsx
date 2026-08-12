import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AgentTaskTimeline from '../../src/components/chat/AgentTaskTimeline';
import { DEFAULT_AGENT_TASK_METRICS, type AgentTask } from '../../src/types/agent';

function task(): AgentTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    userMessageId: 'message-1',
    mode: 'collaborative',
    goal: 'audit canvas',
    status: 'running',
    steps: [],
    modelRounds: 0,
    toolCallCount: 0,
    budget: {
      maxModelRounds: 12,
      maxToolCalls: 24,
      maxParallelReadTools: 3,
      maxReadRetries: 3,
    },
    skillBindings: [
      { skillId: 'skill-1', name: 'Canvas audit', content: 'private instructions' },
      { skillId: 'skill-2', name: 'Asset review', content: 'another private body' },
    ],
    metrics: { ...DEFAULT_AGENT_TASK_METRICS },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('AgentTaskTimeline Skill bindings', () => {
  it('shows bound Skill names without exposing their instruction bodies', () => {
    const html = renderToStaticMarkup(
      <AgentTaskTimeline
        task={task()}
        mediaModelOptions={[]}
        mediaModelAvailability={{}}
        onResolveApproval={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onStop={() => {}}
        onSkip={() => {}}
        onReplan={() => {}}
        onRewind={() => {}}
      />,
    );

    expect(html).toContain('已注入 Skill');
    expect(html).toContain('Canvas audit、Asset review');
    expect(html).not.toContain('private instructions');
    expect(html).not.toContain('another private body');
  });
});
