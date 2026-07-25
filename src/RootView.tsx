/**
 * 根据窗口查询参数懒加载主应用、资产搜索或独立聊天根视图，并提供统一错误边界。
 */
import { lazy, Suspense } from 'react';
import LazyLoadBoundary, { LazyLoadFallback } from './components/shared/LazyLoadBoundary';
import OverlayScrollbarLayer from './components/shared/OverlayScrollbarLayer';

const App = lazy(() => import('./App'));
const AssetSearchWindow = lazy(() => import('./components/AssetSearchWindow'));
const ChatWindow = lazy(() => import('./components/chat/ChatWindow'));

interface RootViewProps {
  view: string | null;
}

export default function RootView({ view }: RootViewProps) {
  const viewLabel = view === 'assets'
    ? '资产搜索窗口'
    : view === 'chat'
      ? '独立聊天窗口'
      : 'AI Canvas';

  return (
    <>
      <LazyLoadBoundary label={viewLabel} variant="root">
        <Suspense fallback={<LazyLoadFallback label={viewLabel} variant="root" />}>
          {view === 'assets' ? <AssetSearchWindow /> : view === 'chat' ? <ChatWindow /> : <App />}
        </Suspense>
      </LazyLoadBoundary>
      <OverlayScrollbarLayer />
    </>
  );
}
