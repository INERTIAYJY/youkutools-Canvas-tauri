import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AgentTaskCenter from '../../src/components/chat/AgentTaskCenter';

vi.mock('../../src/components/chat/AgentTaskTimeline', () => ({
  default: function AgentTaskTimelineMock() {
    return null;
  },
}));

describe('AgentTaskCenter', () => {
  it('keeps a visible return action and both task filters in the header', () => {
    const markup = renderToStaticMarkup(
      <AgentTaskCenter
        tasks={[]}
        conversations={[]}
        onClose={vi.fn()}
        onResolveApproval={vi.fn()}
        mediaModelOptions={[]}
        mediaModelAvailability={{}}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        onSkip={vi.fn()}
        onReplan={vi.fn()}
        onRewind={vi.fn()}
      />,
    );

    expect(markup).toContain('agent-task-center');
    expect(markup).toContain('aria-label="返回对话"');
    expect(markup).toContain('aria-label="Agent 任务中心"');
    expect(markup).toContain('进行中');
    expect(markup).toContain('全部');
    expect(markup).not.toContain('aria-label="关闭任务中心"');
  });
});
