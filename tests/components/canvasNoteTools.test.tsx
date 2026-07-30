import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CanvasDrawingToolbar from '../../src/components/canvas/CanvasDrawingToolbar';
import CanvasNoteStylePanel from '../../src/components/canvas/CanvasNoteStylePanel';
import CanvasNoteShape from '../../src/components/noteNodes/CanvasNoteShape';
import { createCanvasNoteData } from '../../src/types';

const noOp = vi.fn();

function renderPanel(kind: Parameters<typeof createCanvasNoteData>[0], selected = false) {
  return renderToStaticMarkup(
    <CanvasNoteStylePanel
      note={createCanvasNoteData(kind)}
      selected={selected}
      onPatch={noOp}
      onTransientPatch={noOp}
      onBeginChange={noOp}
      onEndChange={noOp}
      onDuplicate={noOp}
      onDelete={noOp}
      onMoveLayer={noOp}
      onCrop={noOp}
    />,
  );
}

describe('canvas note tools', () => {
  it('renders selection plus all nine requested note tools without shortcut bindings', () => {
    const html = renderToStaticMarkup(
      <CanvasDrawingToolbar activeTool="rectangle" imageReady={false} onSelectTool={noOp} />,
    );
    expect((html.match(/<button/g) ?? [])).toHaveLength(10);
    expect(html).toContain('aria-label="矩形"');
    expect(html).toContain('aria-label="图片笔记"');
    expect(html).toContain('aria-label="橡皮擦"');
    expect(html).not.toContain('aria-keyshortcuts');
    expect(html).not.toContain('canvas-drawing-tool-index');
  });

  it('switches property groups for shapes, text, and images', () => {
    const shape = renderPanel('rectangle');
    expect(shape).toContain('描边');
    expect(shape).toContain('填充');
    expect(shape).toContain('边框样式');
    expect(shape).not.toContain('字体大小');

    const text = renderPanel('text');
    expect(text).toContain('字体');
    expect(text).toContain('字体大小');
    expect(text).toContain('文本对齐');
    expect(text).not.toContain('填充');

    const image = renderPanel('image', true);
    expect(image).toContain('圆角');
    expect(image).toContain('裁剪');
    expect(image).not.toContain('描边宽度');
  });

  it('renders arrow geometry with a visible arrowhead', () => {
    const note = createCanvasNoteData('arrow', {
      width: 120,
      height: 60,
      points: [{ x: 2, y: 2 }, { x: 118, y: 58 }],
    });
    const html = renderToStaticMarkup(<CanvasNoteShape note={note} />);
    expect((html.match(/<path/g) ?? [])).toHaveLength(2);
    expect(html).toContain('M 2 2 L 118 58');
  });
});
