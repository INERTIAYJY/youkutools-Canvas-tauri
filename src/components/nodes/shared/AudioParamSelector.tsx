/**
 * 音频节点参数选择器，根据语音、音乐或音效用途展示对应格式、声音和时长配置。
 */
import { Icon } from '@iconify/react';
import { memo, useEffect, useRef, useState } from 'react';
import type { AudioOutputFormat, AudioSpeechReference, AudioSpeechSettings, AudioSpeechWorkflowControls, AudioTtsVoice } from '../../../types/aiTypes';
import type { AudioGenerationPurpose } from '../../../types/media';
import AnimatedButton from '../../shared/AnimatedButton';
import Select from '../../shared/Select';
import { AUDIO_SPEECH_PACES, AUDIO_SPEECH_VOICES, audioSpeechModeIssue, normalizeAudioSpeechSettings } from '../../../services/ai/audioSpeechSettings';
import { useT } from '../../../i18n';

interface AudioParamSelectorProps {
  speechControls?: AudioSpeechWorkflowControls;
  speechSettings?: AudioSpeechSettings;
  references?: AudioSpeechReference[];
  onChangeSpeechSettings?: (value: AudioSpeechSettings) => void;
  onAddReference?: () => void;
  onRemoveReference?: (reference: AudioSpeechReference) => void;
  purpose?: AudioGenerationPurpose;
  voice?: AudioTtsVoice;
  format?: AudioOutputFormat;
  speed?: number;
  musicTitle?: string;
  musicLyrics?: string;
  musicBpm?: number;
  musicDuration?: number;
  autoGenerateLyrics?: boolean;
  onChangeVoice?: (value: AudioTtsVoice) => void;
  onChangeFormat?: (value: AudioOutputFormat) => void;
  onChangeSpeed?: (value: number) => void;
  onChangeMusicTitle?: (value: string) => void;
  onChangeMusicLyrics?: (value: string) => void;
  onChangeMusicBpm?: (value: number | undefined) => void;
  onChangeMusicDuration?: (value: number) => void;
  onChangeAutoGenerateLyrics?: (value: boolean) => void;
  onContinuousEditEnd?: () => void;
}

const VOICES: Array<{ value: AudioTtsVoice; label: string }> = [
  { value: 'alloy', label: 'Alloy' },
  { value: 'echo', label: 'Echo' },
  { value: 'fable', label: 'Fable' },
  { value: 'onyx', label: 'Onyx' },
  { value: 'nova', label: 'Nova' },
  { value: 'shimmer', label: 'Shimmer' },
];

const FORMATS: AudioOutputFormat[] = ['wav', 'opus', 'aac', 'flac', 'pcm'];

function AudioParamSelector({
  speechControls,
  speechSettings,
  references = [],
  onChangeSpeechSettings,
  onAddReference,
  onRemoveReference,
  purpose,
  voice = 'alloy',
  format = 'wav',
  speed = 1,
  musicTitle = '',
  musicLyrics = '',
  musicBpm,
  musicDuration = 60,
  autoGenerateLyrics = false,
  onChangeVoice,
  onChangeFormat,
  onChangeSpeed,
  onChangeMusicTitle,
  onChangeMusicLyrics,
  onChangeMusicBpm,
  onChangeMusicDuration,
  onChangeAutoGenerateLyrics,
  onContinuousEditEnd,
}: AudioParamSelectorProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      // UI Kit 下拉菜单挂在 body，选择音色时仍属于当前参数面板。
      if (event.target instanceof Element && event.target.closest('[data-ui-select-portal]')) return;
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick, true);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  if (!purpose) return null;

  const speech = normalizeAudioSpeechSettings(speechSettings, speechControls?.duration);
  const hasReference = references.length > 0;
  const modeIssue = speechControls ? audioSpeechModeIssue(speechControls, hasReference) : undefined;
  const voiceLabel = AUDIO_SPEECH_VOICES.find((item) => item.value === speech.voiceStyle)!.label;
  const addReference = () => { setOpen(false); onAddReference?.(); };
  const triggerLabel = speechControls
    ? `${hasReference ? t('参考音色') : t(voiceLabel)} · ${t(AUDIO_SPEECH_PACES[speech.pace].label)} · ${speech.duration}s`
    : purpose === 'speech'
    ? `${voice} · ${format.toUpperCase()} · ${speed}x`
    : `${musicDuration}s${musicBpm ? ` · ${musicBpm} BPM` : ''}`;

  return (
    <div className="ui-schema-renderer" data-ui-schema-placement="audioParams" ref={ref}>
      <div className="ui-schema-quality-ratio-pill">
        <AnimatedButton
          type="button"
          className="img-pill-btn ui-schema-menu-trigger"
          aria-expanded={open}
          data-tooltip={purpose === 'speech' ? t('语音参数') : t('音乐参数')}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          <Icon icon={purpose === 'speech' ? 'mdi:account-voice' : 'mdi:music-note'} width={13} />
          <span className="ui-schema-pill-label ui-schema-quality-ratio-label">{triggerLabel}</span>
        </AnimatedButton>

        {open ? (
          <div className="img-ratio-popup ui-schema-popup ui-schema-video-params-popup block">
            {speechControls ? (
              <div className="flex flex-col gap-3 text-xs text-canvas-text" data-audio-speech-mode={hasReference ? 'reference' : 'text'}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{t(hasReference ? '带参考语音' : '纯文本')}</span>
                  <button type="button" className="ui-btn ui-btn--sm" onClick={addReference}>{t('+ 添加参考')}</button>
                </div>
                {hasReference ? (
                  <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
                    {references.map((reference) => (
                      <div key={reference.key} className="ui-card shrink-0 p-2.5">
                        <div className="flex min-w-0 items-center gap-2.5 text-left">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-hover text-canvas-text-secondary">
                            <Icon icon="lucide:audio-lines" width={18} aria-hidden="true" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium leading-5" title={reference.label}>{reference.label}</div>
                            <div className="text-[10px] leading-4 text-canvas-text-muted">
                              {t(reference.url ? '使用此声音的音色' : '音频已失效，请替换')}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button type="button" className="ui-btn ui-btn--sm" aria-label={t('替换参考 {label}', { label: reference.label })}
                              onClick={() => { onRemoveReference?.(reference); addReference(); }}>{t('替换')}</button>
                            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title={t('移除参考')}
                              aria-label={t('移除参考 {label}', { label: reference.label })}
                              onClick={() => onRemoveReference?.(reference)}>
                              <Icon icon="lucide:x" width={13} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <div className="mb-2 text-canvas-text-secondary">{t('声音类型')}</div>
                    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={t('声音类型')}>
                      {AUDIO_SPEECH_VOICES.map((item) => (
                        <button type="button" key={item.value} aria-pressed={speech.voiceStyle === item.value}
                          className={`ui-btn ui-btn--sm ${speech.voiceStyle === item.value ? 'is-active' : ''}`}
                          onClick={() => { onChangeSpeechSettings?.({ ...speech, voiceStyle: item.value }); onContinuousEditEnd?.(); }}>
                          {t(item.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="flex flex-col gap-2">
                  <span className="flex justify-between"><span>{t('语速')}</span><span>{t(AUDIO_SPEECH_PACES[speech.pace].label)}</span></span>
                  <input type="range" className="rh-duration-input" min={0} max={4} step={1} value={speech.pace}
                    onChange={(event) => onChangeSpeechSettings?.({ ...speech, pace: Number(event.target.value) })}
                    onPointerUp={onContinuousEditEnd} onKeyUp={onContinuousEditEnd} onBlur={onContinuousEditEnd} />
                  <span className="flex justify-between text-canvas-text-secondary"><span>{t('慢')}</span><span>{t('正常')}</span><span>{t('快')}</span></span>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="flex items-center justify-between gap-2"><span>{t('生成时长（秒）')}</span>
                    <input type="number" className="ui-input ui-input--sm w-20" min={1} max={3600} step={1} value={speech.duration}
                      onChange={(event) => { if (event.target.value) onChangeSpeechSettings?.({ ...speech, duration: Number(event.target.value) }); }}
                      onBlur={onContinuousEditEnd} />
                  </span>
                  <input type="range" className="rh-duration-input" min={1} max={Math.max(60, speech.duration)} step={1} value={speech.duration}
                    onChange={(event) => onChangeSpeechSettings?.({ ...speech, duration: Number(event.target.value) })}
                    onPointerUp={onContinuousEditEnd} onKeyUp={onContinuousEditEnd} onBlur={onContinuousEditEnd} />
                </label>
                <p className="text-canvas-text-secondary">{t('语速通过描述控制，实际效果以生成结果为准。')}</p>
                {modeIssue ? <p role="status" className="text-canvas-text-secondary">{t(modeIssue)}</p> : null}
              </div>
            ) : purpose === 'speech' ? (
              <div className="rh-v5-meta-panel">
                <label className="rh-vram-adv-row">
                  <span className="rh-vram-adv-label">{t('音色')}</span>
                  <Select
                    className="w-full"
                    fixedMenu
                    aria-label={t('音色')}
                    value={voice}
                    onChange={(value) => onChangeVoice?.(value)}
                    options={VOICES}
                  />
                </label>

                <div className="img-rp-quality-area">
                  <div className="img-rp-section-label">{t('输出格式')}</div>
                  <div className="img-rp-quality-segmented rh-video-resolution-seg">
                    {FORMATS.map((item) => (
                      <AnimatedButton
                        key={item}
                        type="button"
                        className={`img-rp-quality-item rh-v5-res-btn ui-schema-option ${format === item ? 'active' : ''}`}
                        onClick={() => onChangeFormat?.(item)}
                      >
                        {item.toUpperCase()}
                      </AnimatedButton>
                    ))}
                  </div>
                </div>

                <label className="rh-vram-adv-row">
                  <span className="rh-vram-adv-label">{t('语速 {speed}x', { speed })}</span>
                  <input
                    type="range"
                    className="rh-duration-input"
                    min={0.25}
                    max={4}
                    step={0.05}
                    value={speed}
                    onChange={(event) => onChangeSpeed?.(Number(event.target.value))}
                    onBlur={onContinuousEditEnd}
                  />
                </label>
              </div>
            ) : (
              <div className="rh-v5-meta-panel">
                <label className="rh-vram-adv-row">
                  <span className="rh-vram-adv-label">{t('标题')}</span>
                  <input
                    className="w-full rounded-md border border-canvas-border bg-canvas-bg px-2 py-1.5 text-xs text-canvas-text outline-none focus:border-orange-400"
                    value={musicTitle}
                    maxLength={120}
                    onChange={(event) => onChangeMusicTitle?.(event.target.value)}
                    onBlur={onContinuousEditEnd}
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="rh-vram-adv-row">
                    <span className="rh-vram-adv-label">BPM</span>
                    <input
                      type="number"
                      className="w-full rounded-md border border-canvas-border bg-canvas-bg px-2 py-1.5 text-xs text-canvas-text outline-none focus:border-orange-400"
                      min={1}
                      value={musicBpm ?? ''}
                      onChange={(event) => {
                        const value = event.target.value ? Number(event.target.value) : undefined;
                        onChangeMusicBpm?.(value);
                      }}
                      onBlur={onContinuousEditEnd}
                    />
                  </label>
                  <label className="rh-vram-adv-row">
                    <span className="rh-vram-adv-label">{t('时长 {duration}s', { duration: musicDuration })}</span>
                    <input
                      type="range"
                      className="rh-duration-input"
                      min={1}
                      max={240}
                      step={1}
                      value={musicDuration}
                      onChange={(event) => onChangeMusicDuration?.(Number(event.target.value))}
                      onBlur={onContinuousEditEnd}
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="rh-vram-adv-label">{t('自动生成歌词')}</span>
                  <label className="rh-toggle-switch" data-tooltip={t('先生成歌词，再继续生成音乐')}>
                    <input
                      type="checkbox"
                      checked={autoGenerateLyrics}
                      onChange={(event) => onChangeAutoGenerateLyrics?.(event.target.checked)}
                    />
                    <span className="rh-toggle-track"><span className="rh-toggle-knob" /></span>
                  </label>
                </div>

                {!autoGenerateLyrics ? (
                  <label className="rh-vram-adv-row">
                    <span className="rh-vram-adv-label">{t('歌词')}</span>
                    <textarea
                      className="min-h-24 w-full resize-y rounded-md border border-canvas-border bg-canvas-bg px-2 py-1.5 text-xs leading-5 text-canvas-text outline-none focus:border-orange-400"
                      value={musicLyrics}
                      onChange={(event) => onChangeMusicLyrics?.(event.target.value)}
                      onBlur={onContinuousEditEnd}
                    />
                  </label>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(AudioParamSelector);
