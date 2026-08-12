import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import AgentToolDetails from '../../src/components/chat/AgentToolDetails';
import { useAppStore } from '../../src/store/useAppStore';

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    nodes: [{
      id: 'node-image',
      type: 'source-image',
      position: { x: 10, y: 20 },
      data: {
        type: 'source-image',
        label: '角色参考图',
        imageUrl: 'asset://localhost/reference.png',
      },
    }],
  });
});
describe('AgentToolDetails', () => {
  it('renders parameters, references, changes and results when expanded', () => {
    const html = renderToStaticMarkup(
      <AgentToolDetails
        defaultExpanded
        input={{
          fields: [
            { label: '画面比例', value: '16:9', source: 'resolved' },
            { label: '时长', value: '10 秒' },
          ],
          references: [{
            kind: 'node',
            id: 'node-image',
            label: '角色参考图',
            mediaKind: 'image',
          }],
          changes: [{
            targetId: 'node-image',
            targetLabel: '角色参考图',
            field: '位置 X',
            before: 10,
            after: 120,
          }],
        }}
        result={{ fields: [{ label: '保存状态', value: 'saved' }] }}
      />,
    );

    expect(html).toContain('调用详情');
    expect(html).toContain('画面比例');
    expect(html).toContain('16:9');
    expect(html).toContain('角色参考图');
    expect(html).toContain('asset://localhost/reference.png');
    expect(html).toContain('10');
    expect(html).toContain('120');
    expect(html).toContain('保存状态');
  });

  it('renders nothing without a structured snapshot', () => {
    expect(renderToStaticMarkup(<AgentToolDetails />)).toBe('');
  });
});
