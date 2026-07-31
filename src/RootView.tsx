/**
 * 根据窗口查询参数懒加载主应用、资产搜索或独立聊天根视图，并提供统一错误边界。
 */
import { lazy, Suspense } from 'react';
import LazyLoadBoundary, { LazyLoadFallback } from './components/shared/LazyLoadBoundary';
import OverlayScrollbarLayer from './components/shared/OverlayScrollbarLayer';

const App = lazy(() => import('./App'));
const AssetSearchWindow = lazy(() => import('./components/AssetSearchWindow'));
const ChatWindow = lazy(() => import('./components/chat/ChatWindow'));
// 懒加载：视频编辑器引入 mediabunny（体积大户），只有编辑器窗口才加载
const VideoEditorWindow = lazy(() => import('./components/videoEditor/VideoEditorWindow'));

interface RootViewProps {
  view: string | null;
}

const VIEW_LABELS: Record<string, string> = {
  assets: '资产搜索窗口',
  chat: '独立聊天窗口',
  'video-editor': '视频编辑器窗口',
};

export default function RootView({ view }: RootViewProps) {
  const viewLabel = (view && VIEW_LABELS[view]) || 'AI Canvas';

  return (
    <>
      <LazyLoadBoundary label={viewLabel} variant="root">
        <Suspense fallback={<LazyLoadFallback label={viewLabel} variant="root" />}>
          {view === 'assets'
            ? <AssetSearchWindow />
            : view === 'chat'
              ? <ChatWindow />
              : view === 'video-editor'
                ? <VideoEditorWindow />
                : <App />}
        </Suspense>
      </LazyLoadBoundary>
      <OverlayScrollbarLayer />
    </>
  );
}
