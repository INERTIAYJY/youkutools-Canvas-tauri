/**
 * CanvasBackground — 根据 config.canvasBackground 渲染对应的画布背景主题
 */
import { lazy, Suspense } from 'react';
import { useAppStore } from '../../store/useAppStore';

// 懒加载：两个主题背景引入 three / postprocessing（体积大户），仅在选中对应主题时才加载
const SolarSystemBackground = lazy(() => import('./SolarSystemBackground'));
const NebulaBackground = lazy(() => import('./NebulaBackground'));
const FrostedGlassBackground = lazy(() => import('./FrostedGlassBackground'));

export default function CanvasBackground() {
  const canvasBackground = useAppStore((s) => s.config.canvasBackground);
  const customBgUrl = useAppStore((s) => s.config.customBackgroundUrl);
  const customBgOpacity = useAppStore((s) => s.config.customBackgroundOpacity);
  const performanceMode = useAppStore((s) => s.config.performanceMode === true);

  if (performanceMode && (
    canvasBackground === 'solar-system'
    || canvasBackground === 'nebula'
    || canvasBackground === 'frosted-glass'
  )) {
    return null;
  }

  switch (canvasBackground) {
    case 'solar-system':
      return <Suspense fallback={null}><SolarSystemBackground /></Suspense>;
    case 'nebula':
      return <Suspense fallback={null}><NebulaBackground /></Suspense>;
    case 'off-white':
      return <div className="canvas-bg-off-white" />;
    case 'frosted-glass':
      return <Suspense fallback={null}><FrostedGlassBackground /></Suspense>;
    case 'minimal':
      return <div className="canvas-bg-minimal" />;
    case 'custom':
      if (!customBgUrl) return null;
      return (
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url(${customBgUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            opacity: customBgOpacity ?? 0.3,
          }}
        />
      );
    default:
      return null; // 默认暗色由 app-box 自身的 bg-canvas-bg 提供
  }
}
