/**
 * useComfyDomImageSources — 在组件生命周期内绑定 DOM 中的 ComfyUI 图片。
 */
import { useEffect, type RefObject } from 'react';
import { bindComfyDomImageSources } from '../services/comfyDomImageSource';

export function useComfyDomImageSources(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (root) return bindComfyDomImageSources(root);
  }, [rootRef]);
}
