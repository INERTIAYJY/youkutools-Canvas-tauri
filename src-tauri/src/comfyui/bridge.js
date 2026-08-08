(() => {
  if (!['127.0.0.1', 'localhost'].includes(window.location.hostname)) return;
  if (window.__AI_CANVAS_COMFY__) return;

  const WINDOW_DRAG_HEIGHT = 32;
  const WINDOWS_CONTROLS_WIDTH = 120;
  const ACTIONBAR_EDGE_GAP = 8;
  const ACTIONBAR_DOCK_THRESHOLD = WINDOW_DRAG_HEIGHT;
  const COMFY_MENU_DOCKED_KEY = 'Comfy.MenuPosition.Docked';
  const ACTIONBAR_POSITION_KEY = 'ai-canvas.comfy.actionbar-position';
  const isMacOS = /Macintosh|Mac OS X/.test(navigator.userAgent);
  let editorContext = null;
  let pendingSavePayload = null;
  let actionbarElement = null;
  let actionbarCleanup = null;
  let nativeDockingPreferenceRestored = false;

  const nativeDockingPreference = (() => {
    try {
      const value = window.localStorage.getItem(COMFY_MENU_DOCKED_KEY);
      window.localStorage.setItem(COMFY_MENU_DOCKED_KEY, 'true');
      return value;
    } catch {
      return null;
    }
  })();

  const getComfyApp = () => window.app;

  const requestHostAction = (action) => {
    const url = new URL('/__ai_canvas_comfy_action__', window.location.origin);
    url.searchParams.set('action', action);
    window.location.assign(url.href);
  };

  const waitForComfyApp = async () => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const app = getComfyApp();
      if (app?.isGraphReady && typeof app.graphToPrompt === 'function') return app;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('等待 ComfyUI 画布初始化超时');
  };

  const showToast = (app, severity, summary, detail) => {
    app?.extensionManager?.toast?.add?.({ severity, summary, detail, life: 2800 });
  };

  const inferCategory = (output) => {
    const classTypes = Object.values(output || {})
      .map((node) => String(node?.class_type || ''))
      .join(' ');
    if (/audio|sound|saveaudio/i.test(classTypes)) return 'ai-audio';
    if (/video|vhs|animated|webm|mp4/i.test(classTypes)) return 'ai-video';
    if (/image|latent|sampler|vae|save|preview/i.test(classTypes)) return 'ai-image';
    return 'ai-text';
  };

  const sanitizeFileName = (name) => {
    const base = String(name || 'comfyui-workflow')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '_')
      .replace(/\.json$/i, '');
    return `${base || 'comfyui-workflow'}.json`;
  };

  const createWorkflowId = () => {
    const value = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `wf-${value}`;
  };

  const requestWorkflowName = async (app) => {
    if (editorContext?.name) return editorContext.name;
    const defaultName = `ComfyUI-工作流-${new Date().toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).replace(/\//g, '-')}`;
    const value = await app.extensionManager?.dialog?.prompt?.({
      title: '保存工作流到 AI Canvas',
      message: '为当前工作流命名，便于在画布中查找和管理',
      defaultValue: defaultName,
      placeholder: '例如：角色立绘生成、场景概念图',
    });
    return typeof value === 'string' ? value.trim() : '';
  };

  const saveToAICanvas = async () => {
    let app;
    try {
      if (pendingSavePayload) {
        showToast(getComfyApp(), 'info', '正在保存', '请等待当前工作流保存完成');
        return;
      }
      app = await waitForComfyApp();
      const name = await requestWorkflowName(app);
      if (!name) return;
      const { workflow, output } = await app.graphToPrompt();
      const payload = {
        workflowId: editorContext?.workflowId || createWorkflowId(),
        name,
        category: editorContext?.category || inferCategory(output),
        fileName: editorContext?.fileName || sanitizeFileName(name),
        fileContent: JSON.stringify(output, null, 2),
        editableContent: JSON.stringify(workflow, null, 2),
      };
      pendingSavePayload = payload;
      window.__AI_CANVAS_PENDING_SAVE_PAYLOAD__ = payload;
      requestHostAction('save');
    } catch (error) {
      pendingSavePayload = null;
      delete window.__AI_CANVAS_PENDING_SAVE_PAYLOAD__;
      showToast(app || getComfyApp(), 'error', '保存失败', String(error?.message || error));
    }
  };

  const completeSave = (success, detail) => {
    if (success && pendingSavePayload) {
      editorContext = { ...editorContext, ...pendingSavePayload };
    }
    pendingSavePayload = null;
    delete window.__AI_CANVAS_PENDING_SAVE_PAYLOAD__;
    showToast(
      getComfyApp(),
      success ? 'success' : 'error',
      success ? '已保存到 AI Canvas' : '保存失败',
      String(detail || ''),
    );
  };

  const installSaveAction = async () => {
    const app = await waitForComfyApp();
    if (window.__AI_CANVAS_COMFY_SAVE_ACTION__) return;
    window.__AI_CANVAS_COMFY_SAVE_ACTION__ = true;
    app.registerExtension({
      name: 'AI Canvas Workflow Bridge',
      actionBarButtons: [{
        icon: 'icon-[lucide--save]',
        label: '保存到 AI Canvas',
        tooltip: '将当前工作流保存回 AI Canvas',
        class: 'ai-canvas-save-action',
        onClick: () => void saveToAICanvas(),
      }],
    });
  };

  const restoreNativeDockingPreference = () => {
    if (nativeDockingPreferenceRestored) return;
    nativeDockingPreferenceRestored = true;
    try {
      if (nativeDockingPreference === null) {
        window.localStorage.removeItem(COMFY_MENU_DOCKED_KEY);
      } else {
        window.localStorage.setItem(COMFY_MENU_DOCKED_KEY, nativeDockingPreference);
      }
    } catch {
      // localStorage may be unavailable in hardened WebView environments.
    }
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const readActionbarPosition = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(ACTIONBAR_POSITION_KEY) || 'null');
      if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
        return { x: value.x, y: value.y, docked: value.docked === true };
      }
    } catch {
      // Ignore invalid or unavailable persisted positions.
    }
    return null;
  };

  const saveActionbarPosition = (position) => {
    try {
      window.localStorage.setItem(ACTIONBAR_POSITION_KEY, JSON.stringify(position));
    } catch {
      // Position persistence is optional; dragging still works without it.
    }
  };

  const setTitlebarDragRegionInset = (container, docked) => {
    const dragRegion = document.querySelector(
      '#ai-canvas-comfy-window-chrome .ai-canvas-drag-region',
    );
    if (!(dragRegion instanceof HTMLElement)) return;
    if (!docked) {
      dragRegion.style.right = '0px';
      return;
    }
    const actionbarWidth = Math.ceil(container.getBoundingClientRect().width);
    const controlsWidth = isMacOS ? ACTIONBAR_EDGE_GAP : WINDOWS_CONTROLS_WIDTH;
    dragRegion.style.right = `${actionbarWidth + controlsWidth}px`;
  };

  const setActionbarDocked = (container, docked) => {
    container.classList.toggle('ai-canvas-actionbar-docked', docked);
    setTitlebarDragRegionInset(container, docked);
    if (!docked) return;
    container.style.left = 'auto';
    container.style.top = '0px';
    container.style.right = isMacOS ? `${ACTIONBAR_EDGE_GAP}px` : `${WINDOWS_CONTROLS_WIDTH}px`;
    container.style.bottom = 'auto';
  };

  const setActionbarPosition = (container, x, y, allowTopDock = false) => {
    const rect = container.getBoundingClientRect();
    const horizontalLimit = Math.max(0, window.innerWidth - rect.width);
    const verticalLimit = Math.max(0, window.innerHeight - rect.height);
    const minX = Math.min(ACTIONBAR_EDGE_GAP, horizontalLimit);
    const minY = Math.min(allowTopDock ? 0 : ACTIONBAR_EDGE_GAP, verticalLimit);
    const maxX = Math.max(minX, horizontalLimit - ACTIONBAR_EDGE_GAP);
    const maxY = Math.max(minY, verticalLimit - ACTIONBAR_EDGE_GAP);
    const nextPosition = {
      x: clamp(x, minX, maxX),
      y: clamp(y, minY, maxY),
    };
    container.style.left = `${nextPosition.x}px`;
    container.style.top = `${nextPosition.y}px`;
    container.style.right = 'auto';
    container.style.bottom = 'auto';
    return nextPosition;
  };

  const attachActionbarDragging = (container) => {
    const dragHandle = container.querySelector('.actionbar .drag-handle');
    if (!(dragHandle instanceof HTMLElement)) return false;

    actionbarCleanup?.();
    const initialRect = container.getBoundingClientRect();
    const savedPosition = readActionbarPosition();
    actionbarElement = container;
    container.classList.add('ai-canvas-floating-actionbar');
    if (savedPosition?.docked) {
      setActionbarDocked(container, true);
    } else {
      setActionbarPosition(
        container,
        savedPosition?.x ?? initialRect.left,
        savedPosition?.y ?? initialRect.top,
      );
    }
    restoreNativeDockingPreference();

    let stopActiveDrag = null;
    const isDragHandleEvent = (event) => (
      event.target instanceof Node && dragHandle.contains(event.target)
    );

    const blockNativeMouseDrag = (event) => {
      if (event.button !== 0 || !isDragHandleEvent(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const startDragging = (event) => {
      if (
        event.button !== 0
        || event.isPrimary === false
        || !isDragHandleEvent(event)
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const dockedRect = container.getBoundingClientRect();
      setActionbarDocked(container, false);
      setActionbarPosition(container, dockedRect.left, dockedRect.top, true);
      const rect = container.getBoundingClientRect();
      const origin = { x: rect.left, y: rect.top };
      const pointer = { x: event.clientX, y: event.clientY };
      container.classList.add('ai-canvas-actionbar-dragging');
      dragHandle.setPointerCapture?.(event.pointerId);

      const stopDragging = () => {
        window.removeEventListener('pointermove', moveActionbar, true);
        window.removeEventListener('pointerup', stopDragging, true);
        window.removeEventListener('pointercancel', stopDragging, true);
        container.classList.remove('ai-canvas-actionbar-dragging');
        const currentRect = container.getBoundingClientRect();
        const shouldDock = currentRect.top <= ACTIONBAR_DOCK_THRESHOLD;
        if (shouldDock) {
          setActionbarDocked(container, true);
          saveActionbarPosition({
            x: currentRect.left,
            y: currentRect.top,
            docked: true,
          });
        } else {
          const position = setActionbarPosition(
            container,
            currentRect.left,
            currentRect.top,
          );
          saveActionbarPosition({ ...position, docked: false });
        }
        stopActiveDrag = null;
      };

      const moveActionbar = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        moveEvent.preventDefault();
        setActionbarPosition(
          container,
          origin.x + moveEvent.clientX - pointer.x,
          origin.y + moveEvent.clientY - pointer.y,
          true,
        );
      };

      stopActiveDrag?.();
      stopActiveDrag = stopDragging;
      window.addEventListener('pointermove', moveActionbar, true);
      window.addEventListener('pointerup', stopDragging, true);
      window.addEventListener('pointercancel', stopDragging, true);
    };

    const keepActionbarInBounds = () => {
      if (container.classList.contains('ai-canvas-actionbar-docked')) {
        setActionbarDocked(container, true);
        return;
      }
      const rect = container.getBoundingClientRect();
      const position = setActionbarPosition(container, rect.left, rect.top);
      saveActionbarPosition({ ...position, docked: false });
    };

    container.addEventListener('pointerdown', startDragging, true);
    container.addEventListener('mousedown', blockNativeMouseDrag, true);
    window.addEventListener('resize', keepActionbarInBounds);
    const resizeObserver = new ResizeObserver(keepActionbarInBounds);
    resizeObserver.observe(container);

    actionbarCleanup = () => {
      stopActiveDrag?.();
      resizeObserver.disconnect();
      setTitlebarDragRegionInset(container, false);
      window.removeEventListener('resize', keepActionbarInBounds);
      container.removeEventListener('pointerdown', startDragging, true);
      container.removeEventListener('mousedown', blockNativeMouseDrag, true);
      container.classList.remove(
        'ai-canvas-floating-actionbar',
        'ai-canvas-actionbar-dragging',
        'ai-canvas-actionbar-docked',
      );
      actionbarElement = null;
    };
    return true;
  };

  const installActionbarDragging = () => {
    const syncActionbar = () => {
      const container = document.querySelector('.actionbar-container');
      if (!(container instanceof HTMLElement) || container === actionbarElement) return;
      attachActionbarDragging(container);
    };
    syncActionbar();
    const observer = new MutationObserver(syncActionbar);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const installWindowControls = () => {
    if (!document.body || document.getElementById('ai-canvas-comfy-window-chrome')) return;

    const style = document.createElement('style');
    style.id = 'ai-canvas-comfy-window-chrome-style';
    style.textContent = `
      :root {
        --ai-canvas-brand: #6366f1;
        --ai-canvas-brand-hover: #818cf8;
        --ai-canvas-floating-surface: color-mix(
          in srgb,
          var(--p-content-background, #14141c) 82%,
          transparent
        );
        --ai-canvas-floating-border: color-mix(
          in srgb,
          var(--p-content-border-color, #2a2a3a) 76%,
          white 12%
        );
      }
      body {
        overflow: hidden;
      }
      .actionbar-container {
        box-sizing: border-box;
        height: 41px;
        gap: 4px;
        padding: 4px;
        border-color: transparent;
        border-radius: 14px;
        background:
          linear-gradient(
            var(--ai-canvas-floating-surface),
            var(--ai-canvas-floating-surface)
          ) padding-box,
          linear-gradient(
            145deg,
            var(--ai-canvas-floating-border),
            color-mix(in srgb, var(--ai-canvas-brand) 20%, transparent),
            var(--ai-canvas-floating-border)
          ) border-box;
        box-shadow:
          0 12px 30px rgb(0 0 0 / .3),
          inset 0 1px 0 rgb(255 255 255 / .08);
        backdrop-filter: blur(18px) saturate(130%);
        -webkit-backdrop-filter: blur(18px) saturate(130%);
      }
      .actionbar-container.ai-canvas-floating-actionbar {
        position: fixed;
        z-index: 2147483647;
        margin: 0;
        touch-action: none;
      }
      .actionbar-container.ai-canvas-actionbar-docked {
        height: 36px;
        padding: 2px 4px;
        border-width: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
      }
      .actionbar-container.ai-canvas-actionbar-docked .actionbar {
        border-color: transparent;
        background: transparent;
        box-shadow: none;
      }
      .actionbar-container.ai-canvas-actionbar-dragging {
        cursor: grabbing;
      }
      .actionbar-container.ai-canvas-floating-actionbar .actionbar {
        position: static;
      }
      .actionbar-container.ai-canvas-floating-actionbar .drag-handle {
        cursor: grab;
        touch-action: none;
      }
      .actionbar-container.ai-canvas-actionbar-dragging .drag-handle {
        cursor: grabbing;
      }
      .actionbar-container.ai-canvas-floating-actionbar > div > .border-dashed {
        display: none;
      }
      .actionbar-container [data-testid="action-bar-buttons"] {
        gap: 2px;
      }
      .actionbar-container button {
        border-radius: 9px;
        padding-inline: 8px;
      }
      .actionbar-container button:not(.batch-count button) {
        min-height: 31px;
        height: 31px;
      }
      .actionbar-container button[aria-label][data-testid="queue-button"],
      .actionbar-container button[aria-label][data-testid="queue-mode-menu-trigger"],
      .actionbar-container button[aria-label]:not([data-testid]):not(.batch-count button) {
        min-width: 31px;
      }
      .actionbar-container .queue-button-group {
        height: 31px;
        border-radius: 9px;
      }
      .actionbar-container .batch-count > div {
        width: 48px;
        border-radius: 9px 0 0 9px;
      }
      .actionbar-container .batch-count input {
        padding-inline: 4px 0;
        font-size: 12px;
      }
      .actionbar-container [data-testid="queue-button"] {
        width: 34px;
        min-width: 34px;
        gap: 0;
        padding-inline: 0;
        overflow: hidden;
        font-size: 0;
      }
      .actionbar-container [data-testid="queue-mode-menu-trigger"] {
        width: 24px;
        min-width: 24px;
        padding-inline: 0;
        border-radius: 0 9px 9px 0;
      }
      .actionbar-container [data-testid="queue-overlay-toggle"] {
        padding-inline: 10px;
      }
      .actionbar-container .ai-canvas-save-action {
        min-height: 31px;
        height: 31px;
        padding-inline: 10px;
        border-radius: 9px;
        color: white;
        background-color: var(--ai-canvas-brand);
        box-shadow:
          0 6px 16px rgb(99 102 241 / .3),
          inset 0 1px 0 rgb(255 255 255 / .16);
        transition:
          background-color 140ms ease,
          box-shadow 140ms ease,
          transform 140ms ease;
      }
      .actionbar-container .ai-canvas-save-action:hover {
        color: white;
        background-color: var(--ai-canvas-brand-hover);
        box-shadow:
          0 8px 20px rgb(99 102 241 / .38),
          inset 0 1px 0 rgb(255 255 255 / .2);
      }
      .actionbar-container .ai-canvas-save-action:active {
        transform: scale(.97);
      }
      .actionbar-container .ai-canvas-save-action:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--ai-canvas-brand-hover) 72%, white);
        outline-offset: 2px;
      }
      #ai-canvas-comfy-window-chrome {
        position: fixed;
        inset: 0 0 auto 0;
        z-index: 2147483646;
        height: 36px;
        pointer-events: none;
        user-select: none;
      }
      #ai-canvas-comfy-window-chrome .ai-canvas-drag-region {
        position: fixed;
        inset: 0 0 auto 0;
        height: ${WINDOW_DRAG_HEIGHT}px;
        pointer-events: none;
        z-index: 0;
      }
      #ai-canvas-comfy-window-chrome button {
        font: inherit;
        -webkit-tap-highlight-color: transparent;
      }
      #ai-canvas-comfy-window-chrome .ai-canvas-windows-controls {
        position: absolute;
        top: 0;
        right: 0;
        display: flex;
        height: 36px;
        pointer-events: auto;
      }
      #ai-canvas-comfy-window-chrome .ai-canvas-window-button {
        width: 40px;
        height: 36px;
        display: grid;
        place-items: center;
        border: 0;
        color: var(--p-text-muted-color, currentColor);
        background: transparent;
        cursor: pointer;
        transition: color 120ms ease, background-color 120ms ease;
      }
      #ai-canvas-comfy-window-chrome .ai-canvas-window-button:hover {
        color: var(--p-text-color, currentColor);
        background: var(--p-content-hover-background, ButtonFace);
      }
      #ai-canvas-comfy-window-chrome .ai-canvas-close:hover {
        color: white;
        background: rgb(239 68 68 / .7);
      }
      #ai-canvas-comfy-window-chrome .ai-canvas-mac-controls {
        position: absolute;
        top: 12px;
        left: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border: 1px solid var(--p-content-border-color, ButtonBorder);
        border-radius: 999px;
        background: color-mix(in srgb, var(--p-content-background, Canvas) 45%, transparent);
        box-shadow: 0 8px 20px rgb(0 0 0 / .2);
        backdrop-filter: blur(16px);
        pointer-events: auto;
      }
      #ai-canvas-comfy-window-chrome .ai-canvas-traffic-light {
        width: 12px;
        height: 12px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 1px solid rgb(0 0 0 / .2);
        border-radius: 999px;
        color: rgb(0 0 0 / .6);
        cursor: pointer;
        box-shadow: inset 0 1px 1px rgb(255 255 255 / .3);
        transition: filter 120ms ease, transform 120ms ease;
      }
      #ai-canvas-comfy-window-chrome .ai-canvas-traffic-light:hover {
        filter: brightness(1.08);
        transform: scale(1.08);
      }
      #ai-canvas-comfy-window-chrome .ai-canvas-traffic-light svg {
        opacity: 0;
        transition: opacity 120ms ease;
      }
      #ai-canvas-comfy-window-chrome .ai-canvas-mac-controls:hover svg { opacity: 1; }
      #ai-canvas-comfy-window-chrome .ai-canvas-mac-close { background: #ff5f57; }
      #ai-canvas-comfy-window-chrome .ai-canvas-mac-minimize { background: #febc2e; }
      #ai-canvas-comfy-window-chrome .ai-canvas-mac-expand { background: #28c840; }
      .ai-canvas-comfy-macos .p-scrollpanel.p-component.no-drag.overflow-hidden {
        min-width: 0;
        margin-left: 84px;
      }
    `;
    document.head.appendChild(style);
    document.documentElement.classList.toggle('ai-canvas-comfy-macos', isMacOS);

    const chrome = document.createElement('div');
    chrome.id = 'ai-canvas-comfy-window-chrome';
    chrome.dataset.platform = isMacOS ? 'macos' : 'windows';
    chrome.innerHTML = isMacOS
      ? `
        <div class="ai-canvas-drag-region" aria-hidden="true"></div>
        <div class="ai-canvas-mac-controls">
          <button class="ai-canvas-traffic-light ai-canvas-mac-close" data-window-action="close" type="button" aria-label="关闭">
            <svg width="6" height="6" viewBox="0 0 7 7" aria-hidden="true"><path d="M1.6 1.1 5.9 5.4l-.5.5L1.1 1.6l.5-.5Z" fill="currentColor"/><path d="M5.4 1.1 1.1 5.4l.5.5 4.3-4.3-.5-.5Z" fill="currentColor"/></svg>
          </button>
          <button class="ai-canvas-traffic-light ai-canvas-mac-minimize" data-window-action="minimize" type="button" aria-label="最小化">
            <svg width="6" height="6" viewBox="0 0 7 7" aria-hidden="true"><rect x="1" y="3" width="5" height="1" rx=".5" fill="currentColor"/></svg>
          </button>
          <button class="ai-canvas-traffic-light ai-canvas-mac-expand" data-window-action="maximize" type="button" aria-label="全屏">
            <svg width="6" height="6" viewBox="0 0 7 7" aria-hidden="true"><path d="M1.4 1h4.2L1 5.6V1.4C1 1.18 1.18 1 1.4 1Z" fill="currentColor"/><path d="M5.6 6H1.4L6 1.4v4.2c0 .22-.18.4-.4.4Z" fill="currentColor"/></svg>
          </button>
        </div>`
      : `
        <div class="ai-canvas-drag-region" aria-hidden="true"></div>
        <div class="ai-canvas-windows-controls">
          <button class="ai-canvas-window-button" data-window-action="minimize" type="button" aria-label="最小化">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0" y="5" width="10" height="1" fill="currentColor"/></svg>
          </button>
          <button class="ai-canvas-window-button" data-window-action="maximize" type="button" aria-label="最大化">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0" y="0" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg>
          </button>
          <button class="ai-canvas-window-button ai-canvas-close" data-window-action="close" type="button" aria-label="关闭">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
          </button>
        </div>`;
    document.body.appendChild(chrome);

    const isInteractiveTarget = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.closest?.('[data-window-action]')) return true;
      if (el.closest?.('button, a, input, select, textarea, [role="button"], [role="menuitem"], [role="tab"], [role="menu"], .p-menubar, .p-menu, .p-dialog-mask, .p-overlaypanel, .comfy-menu, .comfy-tabs, .workflow-tabs, [data-tab-id]')) return true;
      if (el.closest?.('.comfyui-queue-button, .comfyui-button, .p-button, .actionbar-container, .comfyui-menu, .workflow-tab, .p-tabmenu, .p-tabview')) return true;
      return false;
    };

    const DRAG_ACTIVATION_THRESHOLD = 4;
    let dragArmed = null;

    const armFromWindow = (event) => {
      if (event.button !== 0) return;
      if (event.clientY > WINDOW_DRAG_HEIGHT) return;
      if (isInteractiveTarget(event.target)) return;
      dragArmed = {
        startX: event.clientX,
        startY: event.clientY,
        pointerId: event.pointerId,
        moved: false,
      };
    };

    const moveFromWindow = (event) => {
      if (!dragArmed || dragArmed.pointerId !== event.pointerId) return;
      const dx = event.clientX - dragArmed.startX;
      const dy = event.clientY - dragArmed.startY;
      if (!dragArmed.moved && Math.hypot(dx, dy) < DRAG_ACTIVATION_THRESHOLD) return;
      if (!dragArmed.moved) {
        dragArmed.moved = true;
        requestHostAction('start-dragging');
      }
      if (event.clientY > WINDOW_DRAG_HEIGHT) {
        releaseDrag();
      }
    };

    const releaseDrag = (event) => {
      if (!dragArmed || (event?.pointerId != null && dragArmed.pointerId !== event.pointerId)) return;
      dragArmed = null;
    };

    // 使用捕获阶段 + window 监听，避免被 ComfyUI 内部 stopPropagation 拦截
    window.addEventListener('pointerdown', armFromWindow, true);
    window.addEventListener('pointermove', moveFromWindow, true);
    window.addEventListener('pointerup', releaseDrag, true);
    window.addEventListener('pointercancel', releaseDrag, true);

    chrome.querySelectorAll('[data-window-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.windowAction;
        if (action) requestHostAction(action);
      });
    });
  };

  const loadWorkflow = async (payload) => {
    if (!payload?.apiJson) return;
    const app = await waitForComfyApp();
    editorContext = {
      workflowId: payload.workflowId || null,
      name: payload.workflowName || '',
      category: payload.workflowCategory || 'ai-image',
      fileName: payload.workflowFileName || sanitizeFileName(payload.workflowName),
    };
    if (payload.editableJson) {
      await app.loadGraphData(JSON.parse(payload.editableJson), true, true, editorContext.fileName);
    } else {
      await app.loadApiJson(JSON.parse(payload.apiJson), editorContext.fileName);
    }
    showToast(app, 'info', '已从 AI Canvas 打开', editorContext.name);
  };

  const consumePending = () => {
    const pending = window.__AI_CANVAS_PENDING_WORKFLOW__;
    if (!pending) return;
    delete window.__AI_CANVAS_PENDING_WORKFLOW__;
    void loadWorkflow(pending).catch((error) => {
      showToast(getComfyApp(), 'error', '打开工作流失败', String(error?.message || error));
    });
  };

  window.__AI_CANVAS_COMFY__ = {
    completeSave,
    consumePending,
    loadWorkflow,
    saveToAICanvas,
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      installWindowControls();
      installActionbarDragging();
    }, { once: true });
  } else {
    installWindowControls();
    installActionbarDragging();
  }
  void installSaveAction().catch((error) => {
    showToast(getComfyApp(), 'error', 'AI Canvas 按钮加载失败', String(error?.message || error));
  });
  consumePending();
})();
