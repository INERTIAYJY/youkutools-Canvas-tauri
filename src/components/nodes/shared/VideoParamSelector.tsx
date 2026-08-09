/**
 * VideoParamSelector 视频参数选择器
 * - Seedance 模型 → Seedance 参数（分辨率、宽高比、时长、有声视频）
 * - 其他 provider → 通用视频参数（像素分辨率、帧率、时长）
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import AnimatedButton from '../../shared/AnimatedButton';
import type { BaseNodeData } from '../../../types';
import type { VideoReferenceItem } from '../../../types/aiTypes';
import type { DramaCharacter } from '../../../types/dramaAssets';
import { resolveDramaAssetImageRef } from '../../../services/dramaAssetPrompt';
import { getApimartSeedanceCapability } from '../../../services/ai/apimartVideoModels';
import {
  resolveVideoDurationSeconds,
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATION_MAX_SECONDS,
  VIDEO_DURATION_MIN_SECONDS,
} from '../../../services/aiDimensions';
import { modelProtocolUsesVariable } from '../../../services/ai/modelProtocol';
import { useAppStore } from '../../../store/useAppStore';

interface VideoParamSelectorProps {
  provider?: string;
  selectedModel?: string;
  nodeId?: string;
  videoReferences?: VideoReferenceItem[];
  onChangeVideoReferences?: (value: VideoReferenceItem[]) => void;
  // ── ComfyUI / RunningHub ──
  videoResolution?: number;
  videoFps?: number;
  videoFrames?: number;
  onChangeResolution?: (value: number) => void;
  onChangeFps?: (value: number) => void;
  // ── Seedance ──
  seedanceResolution?: string;
  seedanceRatio?: string;
  seedanceDuration?: number;
  generateAudio?: boolean;
  onChangeSeedanceResolution?: (value: string) => void;
  onChangeSeedanceRatio?: (value: string) => void;
  onChangeSeedanceDuration?: (value: number) => void;
  onChangeGenerateAudio?: (value: boolean) => void;
  showSeedanceRatio?: boolean;
  showGenerateAudio?: boolean;
  onContinuousEditEnd?: () => void;
}

const SEEDANCE_RESOLUTIONS = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
];

const SEEDANCE_RATIOS = [
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '9:16', label: '9:16' },
  { value: '21:9', label: '21:9' },
  { value: 'adaptive', label: '自适应' },
];

const FRAME_ROLE_OPTIONS: Array<{ value: VideoReferenceItem['role']; label: string }> = [
  { value: 'first_frame', label: '首帧' },
  { value: 'reference', label: '中间帧' },
  { value: 'last_frame', label: '尾帧' },
];

const COMBO_RESOLUTIONS = [832, 1024, 1280, 1440];
const COMBO_FPS_OPTIONS = [
  { value: 16, label: '16帧' },
  { value: 24, label: '24帧' },
  { value: 30, label: '30帧' },
];

export default function VideoParamSelector({
  provider, selectedModel,
  nodeId, videoReferences, onChangeVideoReferences,
  videoResolution = 832, videoFps = 24, videoFrames = 77,
  onChangeResolution, onChangeFps,
  seedanceResolution = '720p', seedanceRatio = '16:9',
  seedanceDuration, generateAudio,
  onChangeSeedanceResolution, onChangeSeedanceRatio,
  onChangeSeedanceDuration, onChangeGenerateAudio,
  showSeedanceRatio = true, showGenerateAudio = true, onContinuousEditEnd,
}: VideoParamSelectorProps) {
  const [open, setOpen] = useState(false);
  // 正在展开的来源选择器：frame = 加参考帧，character = 加参考角色
  const [pickerFor, setPickerFor] = useState<VideoReferenceItem['kind'] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const generalModels = useAppStore((state) => state.config.generalModels);
  const projectCharacters = useAppStore((state) => state.dramaAssets.characters);
  const globalCharacters = useAppStore((state) => state.globalCharacters);
  const loadGlobalCharacters = useAppStore((state) => state.loadGlobalCharacters);
  // 连线进来的图片节点：参考帧与参考角色都能从这里挑
  const connectedImageNodes = useAppStore(useShallow((state) => {
    if (!nodeId) return [];
    const sourceIds = new Set(state.edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source));
    return state.nodes.filter((node) => sourceIds.has(node.id) && Boolean((node.data as BaseNodeData).imageUrl));
  }));
  const canvasNodes = useAppStore((state) => state.nodes);

  const references = videoReferences ?? [];
  const frameReferences = references.filter((item) => item.kind === 'frame');
  const characterReferences = references.filter((item) => item.kind === 'character');

  const characterOptions = useMemo(() => {
    const merged = [...projectCharacters, ...globalCharacters.filter(
      (character) => !projectCharacters.some((item) => item.id === character.id),
    )];
    return merged.flatMap((character: DramaCharacter) => {
      const resolved = resolveDramaAssetImageRef(character, canvasNodes);
      return resolved ? [{ id: `character:${character.id}`, label: character.name, url: resolved.imageUrl }] : [];
    });
  }, [canvasNodes, globalCharacters, projectCharacters]);

  const addReference = (kind: VideoReferenceItem['kind'], option: { id: string; label: string; url: string }) => {
    setPickerFor(null);
    if (references.some((item) => item.id === option.id && item.kind === kind)) return;
    // 参考帧默认补上还空着的那一端，参考角色一律当普通参考图提交
    const role: VideoReferenceItem['role'] = kind === 'character'
      ? 'reference'
      : frameReferences.some((item) => item.role === 'first_frame') ? 'last_frame' : 'first_frame';
    onChangeVideoReferences?.([...references, {
      id: option.id,
      kind,
      role,
      url: option.url,
      label: option.label,
      sourceNodeId: option.id.startsWith('character:') ? undefined : option.id,
    }]);
  };

  const setFrameRole = (itemId: string, role: VideoReferenceItem['role']) => {
    onChangeVideoReferences?.(references.map((item) => {
      if (item.id === itemId) return { ...item, role };
      // 首帧、尾帧各自唯一
      if (item.kind === 'frame' && role !== 'reference' && item.role === role) {
        return { ...item, role: 'reference' as const };
      }
      return item;
    }));
  };

  // 关弹窗时一并收起来源选择器，下次打开从干净状态开始
  const closePopup = () => {
    setOpen(false);
    setPickerFor(null);
  };

  const removeReference = (itemId: string) => {
    onChangeVideoReferences?.(references.filter((item) => item.id !== itemId));
  };

  const customProtocolSource = useMemo(() => {
    if (provider !== 'general' || !selectedModel) return '';
    const generalModelId = selectedModel.replace(/^general\//, '');
    const generalModel = generalModels?.find((model) => model.id === generalModelId);
    return generalModel?.executionProfile?.protocol
      ? JSON.stringify(generalModel.executionProfile.protocol)
      : '';
  }, [generalModels, provider, selectedModel]);

  const apimartCapability = provider === 'apimart'
    ? getApimartSeedanceCapability(selectedModel)
    : undefined;
  const isNativeSeedance = provider === 'volcengine' || provider === 'dreamina' || Boolean(apimartCapability);
  const customUsesDuration = modelProtocolUsesVariable(customProtocolSource, 'duration', 'seedanceDuration');
  const customUsesResolution = modelProtocolUsesVariable(
    customProtocolSource,
    'resolution',
    'seedanceResolution',
  );
  const customUsesRatio = modelProtocolUsesVariable(customProtocolSource, 'aspectRatio', 'seedanceRatio');
  const customUsesAudio = modelProtocolUsesVariable(customProtocolSource, 'generateAudio');
  const usesDurationControls = isNativeSeedance
    || customUsesDuration
    || customUsesResolution
    || customUsesRatio
    || customUsesAudio;
  // 非 Seedance（ComfyUI / RunningHub / 自建模型）：比例换算成 width/height 后注入请求
  const genericRatios = VIDEO_ASPECT_RATIOS.map((value) => ({ value, label: value }));
  const showGenericRatio = showSeedanceRatio;
  const genericRatio = genericRatios.some((item) => item.value === seedanceRatio)
    ? seedanceRatio
    : VIDEO_ASPECT_RATIOS[0];
  const isVolcengine = provider === 'volcengine';
  const seedanceResolutions = apimartCapability
    ? apimartCapability.resolutions.map((value) => ({ value, label: value === '4k' ? '4K' : value }))
    : SEEDANCE_RESOLUTIONS;
  const seedanceRatios = apimartCapability
    ? apimartCapability.ratios.map((value) => ({ value, label: value }))
    : isNativeSeedance
      ? SEEDANCE_RATIOS
      : genericRatios;
  const minDuration = apimartCapability?.minDuration ?? VIDEO_DURATION_MIN_SECONDS;
  const maxDuration = apimartCapability?.maxDuration ?? VIDEO_DURATION_MAX_SECONDS;
  const resolvedDuration = resolveVideoDurationSeconds(seedanceDuration, videoFrames, videoFps);
  const displayedDuration = Math.min(maxDuration, Math.max(minDuration, resolvedDuration));
  const displayedResolution = seedanceResolutions.some((item) => item.value === seedanceResolution)
    ? seedanceResolution
    : apimartCapability?.defaultResolution ?? seedanceResolution;
  const displayedRatio = seedanceRatios.some((item) => item.value === seedanceRatio)
    ? seedanceRatio
    : apimartCapability?.defaultRatio ?? seedanceRatio;
  const durationLabelValues = new Set([minDuration, 5, 8, 10, 12, maxDuration]);
  // 每一秒都保留一个等宽刻度槽，只隐藏中间文字；位置因此和原生 range 的步进严格一致。
  const durationTicks = Array.from(
    { length: Math.max(1, maxDuration - minDuration + 1) },
    (_, index) => minDuration + index,
  );
  const showResolutionControl = isNativeSeedance || customUsesResolution;
  const showRatioControl = showSeedanceRatio && (isNativeSeedance || customUsesRatio);
  // 所有视频模型都以秒数呈现；协议若需要帧数，由生成入口统一换算。
  const showDurationControl = true;
  const supportsAudio = isVolcengine || Boolean(apimartCapability?.audioField) || customUsesAudio;
  const displayedGenerateAudio = generateAudio ?? apimartCapability?.defaultAudio ?? false;

  useEffect(() => {
    if (!apimartCapability) return;
    if (displayedResolution !== seedanceResolution) {
      onChangeSeedanceResolution?.(displayedResolution);
    }
    if (displayedRatio !== seedanceRatio) {
      onChangeSeedanceRatio?.(displayedRatio);
    }
    if (displayedDuration !== seedanceDuration) {
      onChangeSeedanceDuration?.(displayedDuration);
    }
  }, [
    apimartCapability,
    displayedDuration,
    displayedRatio,
    displayedResolution,
    onChangeSeedanceDuration,
    onChangeSeedanceRatio,
    onChangeSeedanceResolution,
    seedanceDuration,
    seedanceRatio,
    seedanceResolution,
  ]);

  // 角色库是懒加载的，打开来源选择器时补一次全局角色
  useEffect(() => {
    if (pickerFor === 'character' && globalCharacters.length === 0) void loadGlobalCharacters();
  }, [globalCharacters.length, loadGlobalCharacters, pickerFor]);

  // Close popup on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closePopup();
    };
    if (open) document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  // Close popup on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopup();
    };
    if (open) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // ── 触发按钮文案 ──
  const durationLabelParts = [
    showResolutionControl ? displayedResolution : '',
    showDurationControl ? `时长${displayedDuration}s` : '',
    showRatioControl ? displayedRatio : '',
  ].filter(Boolean);
  const durationTriggerLabel = durationLabelParts.length > 0
    ? durationLabelParts.join(' · ')
    : displayedGenerateAudio ? '有声视频' : '无声视频';
  const triggerLabel = usesDurationControls
    ? durationTriggerLabel
    : showGenericRatio
      ? `${genericRatio} · ${videoResolution} · 时长${displayedDuration}s`
      : `时长${displayedDuration}s · 帧率${videoFps} · 分辨率${videoResolution}`;

  return (
    <div className="ui-schema-renderer" data-ui-schema-placement="videoParams" ref={ref}>
      <div className="ui-schema-quality-ratio-pill">
        <AnimatedButton
          type="button"
          className="img-pill-btn ui-schema-menu-trigger"
          onClick={(e) => { e.stopPropagation(); if (open) closePopup(); else setOpen(true); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
          <span className="ui-schema-pill-label ui-schema-quality-ratio-label">{triggerLabel}</span>
        </AnimatedButton>

        {open && (
          <div className="img-ratio-popup ui-schema-popup ui-schema-video-params-popup" style={{ display: 'block' }}>
            {onChangeVideoReferences && (
              <div className="img-rp-quality-area mb-2">
                <div className="img-rp-section-label rh-video-ref-head">
                  <span>
                    参考帧
                    <span className="rh-tip" data-tooltip="可选：指定某张图作为视频的首帧或尾帧，其余作为中间参考帧。不添加时按连线顺序交给模型。">!</span>
                  </span>
                  <button type="button" className="rh-video-ref-add" onClick={() => setPickerFor(pickerFor === 'frame' ? null : 'frame')}>
                    {pickerFor === 'frame' ? '取消' : '＋ 添加'}
                  </button>
                </div>
                {frameReferences.length > 0 && (
                  <div className="rh-video-frame-list">
                    {frameReferences.map((item) => (
                      <div key={item.id} className="rh-video-frame-row">
                        <img className="rh-video-frame-thumb" src={item.url} alt={item.label || '参考帧'} title={item.label} loading="lazy" />
                        <div className="img-rp-quality-segmented rh-video-frame-seg">
                          {FRAME_ROLE_OPTIONS.map((option) => (
                            <AnimatedButton
                              key={option.value}
                              type="button"
                              className={`img-rp-quality-item rh-v5-res-btn ui-schema-option ${item.role === option.value ? 'active' : ''}`}
                              onClick={() => setFrameRole(item.id, option.value)}
                            >
                              {option.label}
                            </AnimatedButton>
                          ))}
                        </div>
                        <button type="button" className="rh-video-ref-remove" aria-label={`移除 ${item.label || '参考帧'}`} onClick={() => removeReference(item.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="img-rp-section-label rh-video-ref-head mt-2">
                  <span>
                    参考角色
                    <span className="rh-tip" data-tooltip="可选：从角色库或连线节点挑选角色形象，作为参考图一起提交。提示词里写到该角色名字时，会自动告诉模型这个名字对应哪张参考图。">!</span>
                  </span>
                  <button type="button" className="rh-video-ref-add" onClick={() => setPickerFor(pickerFor === 'character' ? null : 'character')}>
                    {pickerFor === 'character' ? '取消' : '＋ 添加'}
                  </button>
                </div>
                {characterReferences.length > 0 && (
                  <div className="rh-video-frame-list">
                    {characterReferences.map((item) => (
                      <div key={item.id} className="rh-video-frame-row">
                        <img className="rh-video-frame-thumb" src={item.url} alt={item.label || '参考角色'} title={item.label} loading="lazy" />
                        <span className="rh-video-ref-name">{item.label || '参考角色'}</span>
                        <button type="button" className="rh-video-ref-remove" aria-label={`移除 ${item.label || '参考角色'}`} onClick={() => removeReference(item.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {pickerFor && (() => {
                  // 参考帧只从连线节点挑；角色库只出现在参考角色里
                  const pickerCharacters = pickerFor === 'character' ? characterOptions : [];
                  return (
                  <div className="rh-video-ref-picker">
                    {connectedImageNodes.length > 0 && <div className="rh-video-ref-picker-label">连线节点</div>}
                    {connectedImageNodes.map((node) => {
                      const data = node.data as BaseNodeData;
                      return (
                        <button
                          key={node.id}
                          type="button"
                          className="rh-video-ref-option"
                          onClick={() => addReference(pickerFor, { id: node.id, label: data.label || '参考图', url: data.imageUrl as string })}
                        >
                          <img className="rh-video-frame-thumb" src={data.imageUrl} alt="" loading="lazy" />
                          <span className="rh-video-ref-name">{data.label || '参考图'}</span>
                        </button>
                      );
                    })}
                    {pickerCharacters.length > 0 && <div className="rh-video-ref-picker-label">角色库</div>}
                    {pickerCharacters.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="rh-video-ref-option"
                        onClick={() => addReference(pickerFor, option)}
                      >
                        <img className="rh-video-frame-thumb" src={option.url} alt="" loading="lazy" />
                        <span className="rh-video-ref-name">{option.label}</span>
                      </button>
                    ))}
                    {connectedImageNodes.length === 0 && pickerCharacters.length === 0 && (
                      <div className="rh-video-ref-empty">
                        {pickerFor === 'frame'
                          ? '还没有可选的图片：先给视频节点连一个图片节点'
                          : '还没有可选的角色：先连一个图片节点，或在角色库里添加角色'}
                      </div>
                    )}
                  </div>
                  );
                })()}
              </div>
            )}

            {usesDurationControls ? (
              <>
                {/* Seedance 分辨率 */}
                {showResolutionControl && <div className="img-rp-quality-area mb-2">
                  <div className="img-rp-section-label">
                    分辨率
                    <span className="rh-tip" data-tooltip="分辨率越高细节越清晰，但生成耗时会明显增加。4K 仅 Seedance 2.0 支持。">!</span>
                  </div>
                  <div className="img-rp-quality-segmented rh-video-resolution-seg">
                    {seedanceResolutions.map((opt) => (
                      <AnimatedButton
                        key={opt.value}
                        type="button"
                        className={`img-rp-quality-item rh-v5-res-btn ui-schema-option ${displayedResolution === opt.value ? 'active' : ''}`}
                        onClick={() => onChangeSeedanceResolution?.(opt.value)}
                      >
                        {opt.label}
                      </AnimatedButton>
                    ))}
                  </div>
                </div>}

                {showRatioControl && (
                  <div className="img-rp-quality-area mb-2">
                    <div className="img-rp-section-label">
                      宽高比
                      <span className="rh-tip" data-tooltip="决定输出视频的画面形状：16:9 横屏、9:16 竖屏，自适应 = 由模型智能决定。">!</span>
                    </div>
                    <div className="img-rp-quality-segmented rh-video-resolution-seg">
                      {seedanceRatios.map((opt) => (
                        <AnimatedButton
                          key={opt.value}
                          type="button"
                          className={`img-rp-quality-item rh-v5-res-btn ui-schema-option ${displayedRatio === opt.value ? 'active' : ''}`}
                          onClick={() => onChangeSeedanceRatio?.(opt.value)}
                        >
                          {opt.label}
                        </AnimatedButton>
                      ))}
                    </div>
                  </div>
                )}

                {/* Seedance 时长 */}
                {(showDurationControl || (showGenerateAudio && supportsAudio)) && (
                <div className="rh-v5-meta-panel">
                  {showDurationControl && <div className="rh-vram-adv-row">
                    <div className="rh-vram-adv-label">
                      <span>生成时长（秒）</span>
                      <span className="rh-tip" data-tooltip={`整数秒，范围 ${minDuration}-${maxDuration}。值越大视频越长、耗时越高。`}>!</span>
                    </div>
                    <div className="rh-duration-slider">
                      <div className="rh-duration-track">
                        <div
                          className="rh-duration-fill"
                          style={{ width: `${((displayedDuration - minDuration) / (maxDuration - minDuration)) * 100}%` }}
                        />
                        <input
                          type="range"
                          className="rh-duration-input"
                          min={minDuration}
                          max={maxDuration}
                          step={1}
                          value={displayedDuration}
                          onChange={(e) => onChangeSeedanceDuration?.(Number(e.target.value))}
                          onBlur={onContinuousEditEnd}
                        />
                      </div>
                      <div className="rh-duration-labels">
                        {durationTicks.map((v) => (
                          <span key={v} className={`rh-duration-tick ${displayedDuration >= v ? 'active' : ''}`} onClick={() => onChangeSeedanceDuration?.(v)}>
                            {durationLabelValues.has(v) ? `${v}s` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>}


                  {/* 有声视频开关 — 仅支持音频参数的 Seedance 模型显示 */}
                  {showGenerateAudio && supportsAudio && (
                  <div className="rh-vram-adv-row">
                    <div className="rh-vram-adv-label" style={{ justifyContent: 'space-between', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>生成有声视频</span>
                        <span className="rh-tip" data-tooltip="开启后 Seedance 会同时生成配乐（仅 Seedance 2.0 / 1.5 pro 支持）。">!</span>
                      </div>
                      <label className="rh-toggle-switch">
                        <input
                          type="checkbox"
                          checked={displayedGenerateAudio}
                          onChange={(e) => onChangeGenerateAudio?.(e.target.checked)}
                        />
                        <span className="rh-toggle-track">
                          <span className="rh-toggle-knob" />
                        </span>
                      </label>
                    </div>
                  </div>
                  )}
                </div>
                )}
              </>
            ) : (
              <>
                {showGenericRatio && (
                  <div className="img-rp-quality-area mb-2">
                    <div className="img-rp-section-label">
                      画面比例
                      <span className="rh-tip" data-tooltip="决定输出视频的画面形状：16:9 横屏、9:16 竖屏。分辨率为长边，短边按比例换算后注入工作流的 width/height。">!</span>
                    </div>
                    <div className="img-rp-quality-segmented rh-video-resolution-seg">
                      {genericRatios.map((opt) => (
                        <AnimatedButton
                          key={opt.value}
                          type="button"
                          className={`img-rp-quality-item rh-v5-res-btn ui-schema-option ${genericRatio === opt.value ? 'active' : ''}`}
                          onClick={() => onChangeSeedanceRatio?.(opt.value)}
                        >
                          {opt.label}
                        </AnimatedButton>
                      ))}
                    </div>
                  </div>
                )}

                {/* ComfyUI / RunningHub 分辨率 */}
                <div className="img-rp-quality-area mb-2" data-ui-schema-field="rhVideoResolution" data-ui-schema-type="segmented" data-ui-schema-value-type="number" data-ui-schema-default="832">
                  <div className="img-rp-section-label">
                    分辨率（长边）
                    <span className="rh-tip" data-tooltip="画面长边像素，短边由上方比例换算。分辨率越高细节越清晰、边缘更稳定，显存占用与生成耗时也明显增加。">!</span>
                  </div>
                  <div className="img-rp-quality-segmented rh-video-resolution-seg">
                    {COMBO_RESOLUTIONS.map((res) => (
                      <AnimatedButton
                        key={res}
                        type="button"
                        className={`img-rp-quality-item rh-v5-res-btn ui-schema-option ${videoResolution === res ? 'active' : ''}`}
                        data-value={res}
                        data-ui-schema-value={res}
                        onClick={() => onChangeResolution?.(res)}
                      >
                        {res}
                      </AnimatedButton>
                    ))}
                  </div>
                </div>

                {/* 帧率 & 时长 */}
                <div className="rh-v5-meta-panel">
                  <div className="rh-vram-adv-row">
                    <div className="rh-vram-adv-label">
                      <span>帧率</span>
                      <span className="rh-tip" data-tooltip="帧率越高运动更顺滑、动作更连贯。但生成更慢、成本更高。常用 24 帧。">!</span>
                    </div>
                    <div className="img-rp-quality-segmented rh-adv-seg rh-v5-fps-seg">
                      {COMBO_FPS_OPTIONS.map((opt) => (
                        <AnimatedButton
                          key={opt.value}
                          type="button"
                          className={`img-rp-quality-item rh-v5-fps-btn ui-schema-option ${videoFps === opt.value ? 'active' : ''}`}
                          data-value={opt.value}
                          data-ui-schema-value={opt.value}
                          onClick={() => {
                            // 旧节点只有帧数时，先固定反算出的秒数，避免切换 FPS 改变用户看到的时长。
                            if (!Number.isFinite(seedanceDuration)) {
                              onChangeSeedanceDuration?.(displayedDuration);
                            }
                            onChangeFps?.(opt.value);
                          }}
                        >
                          {opt.label}
                        </AnimatedButton>
                      ))}
                    </div>
                  </div>

                  <div className="rh-vram-adv-row" data-ui-schema-field="videoDuration" data-ui-schema-type="slider">
                    <div className="rh-vram-adv-label">
                      <span>生成时长（秒）</span>
                      <span className="rh-tip" data-tooltip={`整数秒，范围 ${minDuration}-${maxDuration}。提交时会根据帧率自动换算为模型需要的总帧数。`}>!</span>
                    </div>
                    <div className="rh-duration-slider">
                      <div className="rh-duration-track">
                        <div
                          className="rh-duration-fill"
                          style={{ width: `${((displayedDuration - minDuration) / (maxDuration - minDuration)) * 100}%` }}
                        />
                        <input
                          type="range"
                          className="rh-duration-input"
                          min={minDuration}
                          max={maxDuration}
                          step={1}
                          value={displayedDuration}
                          onChange={(e) => onChangeSeedanceDuration?.(Number(e.target.value))}
                          onBlur={onContinuousEditEnd}
                        />
                      </div>
                      <div className="rh-duration-labels">
                        {durationTicks.map((value) => (
                          <span
                            key={value}
                            className={`rh-duration-tick ${displayedDuration >= value ? 'active' : ''}`}
                            onClick={() => onChangeSeedanceDuration?.(value)}
                          >
                            {durationLabelValues.has(value) ? `${value}s` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
