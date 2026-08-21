/**
 * CharacterLibraryPanel — 角色库侧边面板。
 * 列出项目级与全局角色，支持新建、编辑（打开 CharacterAssetDialog）、删除与筛选，
 * 头像取自角色主视觉参考图，全局角色可被跨项目复用。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import { isEligibleCharacterVoiceNode } from '../store/store.dramaAssets';
import type {
  CharacterReferenceImage,
  CharacterVoiceClip,
  DramaCharacter,
} from '../types/dramaAssets';
import ModalOverlay from './shared/ModalOverlay';
import PopupCloseButton from './shared/PopupCloseButton';
import { useT } from '../i18n';
import CharacterAssetDialog from './CharacterAssetDialog';
import CharacterReferenceGallery from './character/CharacterReferenceGallery';
import type { ReferenceStageBox } from './character/CharacterReferenceGallery';
import {
  CHARACTER_VOICE_KIND_LABELS,
  cropImageStyle,
  formatVoiceDuration,
  voiceClipTitle,
} from './character/characterReferencePresentation';
import { readAudioDuration } from './character/characterVoiceMedia';

type CharacterLibraryScope = 'project' | 'global';

function characterAvatar(character: DramaCharacter): CharacterReferenceImage | undefined {
  const references = character.referenceImages ?? [];
  return references.find((reference) => reference.id === character.avatarReferenceImageId)
    ?? references.find((reference) => reference.id === character.primaryReferenceImageId)
    ?? references[0];
}

function CharacterAvatar({ character }: { character: DramaCharacter }) {
  const reference = characterAvatar(character);
  const cropped = reference?.id === character.avatarReferenceImageId && character.avatarCrop;
  return (
    <span className="character-avatar">
      {reference?.imageUrl ? (
        <img
          src={reference.imageUrl}
          alt=""
          draggable={false}
          className={cropped ? 'is-cropped' : ''}
          style={cropped ? cropImageStyle(character.avatarCrop) : undefined}
        />
      ) : (
        <Icon icon="lucide:user-round" width={22} height={22} aria-hidden="true" />
      )}
    </span>
  );
}

export default function CharacterLibraryPanel() {
  const t = useT();
  const {
    open,
    setOpen,
    projectCharacters,
    globalCharacters,
    globalCharactersLoading,
    loadGlobalCharacters,
    copyCharacterToGlobal,
    copyGlobalCharacterToProject,
    deleteDramaAsset,
    deleteGlobalCharacter,
    nodes,
    setCharacterLibraryNodeHidden,
    createImageNodeFromCharacterReference,
    bindAudioNodeToCharacterVoice,
    removeCharacterVoiceClip,
    setCharacterPrimaryVoice,
    createAudioNodeFromCharacterVoice,
    createVoiceOverNodeFromCharacterVoice,
    setSelectedNodeIds,
    showToast,
  } = useAppStore(
    useShallow((state) => ({
      open: state.characterLibraryOpen,
      setOpen: state.setCharacterLibraryOpen,
      projectCharacters: state.dramaAssets.characters,
      globalCharacters: state.globalCharacters,
      globalCharactersLoading: state.globalCharactersLoading,
      loadGlobalCharacters: state.loadGlobalCharacters,
      copyCharacterToGlobal: state.copyCharacterToGlobal,
      copyGlobalCharacterToProject: state.copyGlobalCharacterToProject,
      deleteDramaAsset: state.deleteDramaAsset,
      deleteGlobalCharacter: state.deleteGlobalCharacter,
      nodes: state.nodes,
      setCharacterLibraryNodeHidden: state.setCharacterLibraryNodeHidden,
      createImageNodeFromCharacterReference: state.createImageNodeFromCharacterReference,
      bindAudioNodeToCharacterVoice: state.bindAudioNodeToCharacterVoice,
      removeCharacterVoiceClip: state.removeCharacterVoiceClip,
      setCharacterPrimaryVoice: state.setCharacterPrimaryVoice,
      createAudioNodeFromCharacterVoice: state.createAudioNodeFromCharacterVoice,
      createVoiceOverNodeFromCharacterVoice: state.createVoiceOverNodeFromCharacterVoice,
      setSelectedNodeIds: state.setSelectedNodeIds,
      showToast: state.showToast,
    })),
  );
  const [scope, setScope] = useState<CharacterLibraryScope>('project');
  const [search, setSearch] = useState('');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  // 图片按容器高等比缩小后左右会留白，浮层要贴图片边缘，否则卡片会跨在图片与面板底色的分界上
  const [referenceStage, setReferenceStage] = useState<ReferenceStageBox | null>(null);
  const handleStageResize = useCallback((next: ReferenceStageBox | null) => {
    setReferenceStage((previous) => (
      previous?.width === next?.width && previous?.height === next?.height ? previous : next
    ));
  }, []);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCharacter, setDialogCharacter] = useState<DramaCharacter | null>(null);
  const [dialogReferenceId, setDialogReferenceId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  // 记角色归属，切换角色时自然失效，不必在 effect 里回收状态
  const [playingVoice, setPlayingVoice] = useState<{
    characterId: string;
    clipId: string;
  } | null>(null);
  const [bindingVoice, setBindingVoice] = useState(false);
  const [captureNodeId, setCaptureNodeId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const voicePlayerRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (open) void loadGlobalCharacters();
  }, [loadGlobalCharacters, open]);

  const sourceCharacters = scope === 'project' ? projectCharacters : globalCharacters;
  const characters = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...sourceCharacters]
      .filter((character) => !query || [
        character.name,
        character.summary,
        character.identity,
        character.storyRole,
        character.visualNotes,
      ].some((value) => value?.toLowerCase().includes(query)))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
  }, [search, sourceCharacters]);

  const selectedCharacter = characters.find(
    (character) => character.id === selectedCharacterId,
  ) ?? characters[0] ?? null;
  const effectiveReferenceId = selectedCharacter?.referenceImages?.some(
    (reference) => reference.id === selectedReferenceId,
  )
    ? selectedReferenceId
    : selectedCharacter?.primaryReferenceImageId
      ?? selectedCharacter?.referenceImages?.[0]?.id
      ?? null;
  const selectedReference = selectedCharacter?.referenceImages?.find(
    (reference) => reference.id === effectiveReferenceId,
  ) ?? null;
  const sourceNode = useMemo(() => {
    if (!selectedCharacter || !selectedReference) return null;
    return nodes.find((node) => (
      node.id === selectedReference.sourceNodeId
      || node.data.characterLibraryLinks?.some((link) => (
        link.scope === scope
        && link.characterId === selectedCharacter.id
        && link.referenceImageId === selectedReference.id
      ))
    )) ?? null;
  }, [nodes, scope, selectedCharacter, selectedReference]);
  const canvasActionLabel = sourceNode
    ? sourceNode.data.hiddenByCharacterLibrary
      ? t('显示并定位节点')
      : t('定位画布节点')
    : t('添加到画布');
  const canvasActionIcon = sourceNode
    ? sourceNode.data.hiddenByCharacterLibrary
      ? 'lucide:eye'
      : 'lucide:locate-fixed'
    : 'lucide:square-plus';

  // 画布上还没进过角色库的图片节点，可当作新视角参考图
  const pickableNodes = useMemo(() => nodes.filter((node) => (
    !node.data.hiddenByCharacterLibrary
    && (node.data.imageUrl || node.data.thumbnailUrl)
  )), [nodes]);
  // 画布上带音频产物的节点，可绑定为角色声音
  const pickableAudioNodes = useMemo(
    () => nodes.filter((node) => isEligibleCharacterVoiceNode(node)),
    [nodes],
  );
  const voiceClips = selectedCharacter?.voiceClips ?? [];
  const playingVoiceClipId = playingVoice?.characterId === selectedCharacter?.id
    ? playingVoice?.clipId ?? null
    : null;

  // 切换角色或关闭面板时停止试听，避免声音跟着上一个角色继续播
  useEffect(() => {
    voicePlayerRef.current?.pause();
  }, [open, scope, selectedCharacter?.id]);

  const switchScope = (nextScope: CharacterLibraryScope) => {
    setScope(nextScope);
    setSelectedCharacterId(null);
    setSelectedReferenceId(null);
    setVoicePickerOpen(false);
  };

  const toggleVoicePlayback = (clip: CharacterVoiceClip) => {
    const player = voicePlayerRef.current;
    if (!player || !clip.audioUrl || !selectedCharacter) return;
    if (playingVoiceClipId === clip.id) {
      player.pause();
      return;
    }
    player.src = clip.audioUrl;
    void player.play()
      .then(() => setPlayingVoice({ characterId: selectedCharacter.id, clipId: clip.id }))
      .catch(() => showToast(t('音频播放失败'), 'error'));
  };

  const handleBindVoiceNode = async (nodeId: string) => {
    if (!selectedCharacter) return;
    const node = nodes.find((item) => item.id === nodeId);
    const audioUrl = node?.data.audioUrl;
    if (!audioUrl) {
      showToast(t('该节点没有可用的音频'), 'error');
      return;
    }
    setVoicePickerOpen(false);
    setBindingVoice(true);
    const clipId = await bindAudioNodeToCharacterVoice({
      nodeId,
      scope,
      characterId: selectedCharacter.id,
      label: node?.data.label,
      durationSec: await readAudioDuration(audioUrl),
    });
    setBindingVoice(false);
    if (!clipId) return;
    showToast(scope === 'project' ? t('已绑定到本项目角色声音') : t('已绑定到全局角色声音'));
  };

  const handleRemoveVoiceClip = async (clip: CharacterVoiceClip) => {
    if (!selectedCharacter) return;
    if (playingVoiceClipId === clip.id) voicePlayerRef.current?.pause();
    if (await removeCharacterVoiceClip(scope, selectedCharacter.id, clip.id)) {
      showToast(t('已移除该声音'));
    }
  };

  const focusNode = (nodeId: string) => {
    setOpen(false);
    setSelectedNodeIds([nodeId]);
    window.dispatchEvent(new CustomEvent('canvas-focus-node', { detail: { nodeId } }));
  };

  const handleVoiceToCanvas = (clip: CharacterVoiceClip) => {
    if (!selectedCharacter) return;
    const nodeId = createAudioNodeFromCharacterVoice(scope, selectedCharacter.id, clip.id);
    if (nodeId) focusNode(nodeId);
  };

  const handleVoiceOver = (clip: CharacterVoiceClip) => {
    if (!selectedCharacter) return;
    const nodeId = createVoiceOverNodeFromCharacterVoice(scope, selectedCharacter.id, clip.id);
    if (!nodeId) return;
    showToast(t('已创建配音节点，声音已连线为音色参考'));
    focusNode(nodeId);
  };

  const openEditor = (character: DramaCharacter | null, referenceId?: string | null) => {
    setDialogCharacter(character);
    setDialogReferenceId(referenceId ?? null);
    setDialogOpen(true);
  };

  const handleCopy = async () => {
    if (!selectedCharacter) return;
    if (scope === 'project') {
      const copiedId = await copyCharacterToGlobal(selectedCharacter.id);
      if (!copiedId) return;
      showToast(t('已复制到全局资产'));
      setScope('global');
      setSelectedCharacterId(copiedId);
      setSelectedReferenceId(null);
      return;
    }
    const copiedId = copyGlobalCharacterToProject(selectedCharacter.id);
    if (!copiedId) return;
    showToast(t('已复制到本项目'));
    setScope('project');
    setSelectedCharacterId(copiedId);
    setSelectedReferenceId(null);
  };

  const handleDelete = async () => {
    if (!selectedCharacter) return;
    setDeleteConfirmOpen(false);
    if (scope === 'project') {
      deleteDramaAsset('character', selectedCharacter.id);
    } else if (!await deleteGlobalCharacter(selectedCharacter.id)) {
      return;
    }
    showToast(t('角色已删除'));
    setSelectedCharacterId(null);
    setSelectedReferenceId(null);
  };

  const handleCanvasAction = () => {
    if (!selectedCharacter || !selectedReference) return;
    let nodeId = sourceNode?.id ?? null;
    if (sourceNode?.data.hiddenByCharacterLibrary) {
      setCharacterLibraryNodeHidden(sourceNode.id, false);
      showToast(t('节点已显示'));
    } else if (!sourceNode) {
      nodeId = createImageNodeFromCharacterReference(
        scope,
        selectedCharacter.id,
        selectedReference.id,
      );
      if (!nodeId) return;
      showToast(t('已将角色参考图添加到画布'));
    }
    if (!nodeId) return;

    setOpen(false);
    setSelectedNodeIds([nodeId]);
    window.dispatchEvent(new CustomEvent('canvas-focus-node', { detail: { nodeId } }));
  };

  return (
    <>
      <ModalOverlay
        isOpen={open}
        onClose={() => setOpen(false)}
        ariaLabel={t('角色库')}
        className="character-library-panel"
      >
        <div className="character-library-toolbar">
          <div className="character-library-tabs" role="tablist" aria-label={t('角色保存范围')}>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'project'}
              className={scope === 'project' ? 'is-active' : ''}
              onClick={() => switchScope('project')}
            >
              {t('本项目')}
              <span>{projectCharacters.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'global'}
              className={scope === 'global' ? 'is-active' : ''}
              onClick={() => switchScope('global')}
            >
              {t('全局资产')}
              <span>{globalCharacters.length}</span>
            </button>
          </div>
          <label className="character-library-search">
            <Icon icon="lucide:search" width="15" height="15" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('搜索角色、身份或简介')}
            />
            {search ? (
              <button type="button" aria-label={t('清空搜索')} onClick={() => setSearch('')}>
                <Icon icon="lucide:x" width="13" height="13" aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <button type="button" className="character-library-new" onClick={() => openEditor(null)}>
            <Icon icon="lucide:plus" width="13" height="13" aria-hidden="true" />
            {t('新建角色')}
          </button>
          <PopupCloseButton onClick={() => setOpen(false)} />
        </div>

        <main className="character-library-content">
          {scope === 'global' && globalCharactersLoading ? (
            <div className="character-library-empty">
              <Icon icon="lucide:loader-circle" className="animate-spin" width="26" height="26" aria-hidden="true" />
              <p>{t('正在读取全局角色…')}</p>
            </div>
          ) : selectedCharacter ? (
            <section
              className="character-library-gallery"
              aria-label={t('多图参考')}
              style={referenceStage ? {
                '--character-stage-width': `${referenceStage.width}px`,
                '--character-stage-height': `${referenceStage.height}px`,
              } as CSSProperties : undefined}
            >
              <CharacterReferenceGallery
                references={selectedCharacter.referenceImages ?? []}
                selectedId={effectiveReferenceId}
                onSelect={setSelectedReferenceId}
                onEdit={(referenceId) => openEditor(selectedCharacter, referenceId)}
                onStageResize={handleStageResize}
              />

              <div className="character-library-dock">
                {pickerOpen ? (
                  <div className="character-node-picker" role="listbox" aria-label={t('选择画布图片节点')}>
                    {pickableNodes.length === 0 ? (
                      <span className="character-node-picker-empty">{t('画布上没有可用的图片节点')}</span>
                    ) : pickableNodes.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setCaptureNodeId(node.id);
                          setPickerOpen(false);
                        }}
                      >
                        <img src={node.data.imageUrl ?? node.data.thumbnailUrl} alt="" draggable={false} />
                        <span>{node.data.label || t('图片节点')}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <section className="character-voice-dock" aria-label={t('角色声音')}>
                  <div className="character-voice-dock-head">
                    <Icon icon="lucide:audio-lines" width="14" height="14" aria-hidden="true" />
                    <span>{t('角色声音')}</span>
                    <strong>{voiceClips.length}</strong>
                    <button
                      type="button"
                      data-tooltip={t('绑定画布音频节点')}
                      aria-label={t('绑定画布音频节点')}
                      aria-expanded={voicePickerOpen}
                      className={voicePickerOpen ? 'is-active' : ''}
                      disabled={bindingVoice}
                      onClick={() => {
                        setPickerOpen(false);
                        setVoicePickerOpen((current) => !current);
                      }}
                    >
                      <Icon icon="lucide:link" width="15" height="15" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      data-tooltip={t('上传音频')}
                      aria-label={t('上传音频')}
                      onClick={() => openEditor(selectedCharacter)}
                    >
                      <Icon icon="lucide:upload" width="15" height="15" aria-hidden="true" />
                    </button>
                  </div>

                  {voicePickerOpen ? (
                    <div className="character-voice-picker" role="listbox" aria-label={t('选择画布音频节点')}>
                      {pickableAudioNodes.length === 0 ? (
                        <span className="character-node-picker-empty">{t('画布上没有可用的音频节点')}</span>
                      ) : pickableAudioNodes.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => void handleBindVoiceNode(node.id)}
                        >
                          <Icon icon="lucide:audio-lines" width="15" height="15" aria-hidden="true" />
                          <span>{node.data.label || t('音频节点')}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {voiceClips.length === 0 ? (
                    <p className="character-voice-dock-empty">
                      {bindingVoice ? t('正在绑定…') : t('还没有声音，可绑定画布音频节点或上传音频')}
                    </p>
                  ) : (
                    <div className="character-voice-chips" role="list">
                      {voiceClips.map((clip) => (
                        <div
                          key={clip.id}
                          role="listitem"
                          className={`character-voice-chip${
                            clip.id === selectedCharacter.primaryVoiceClipId ? ' is-primary' : ''
                          }`}
                        >
                          <button
                            type="button"
                            className="character-voice-play"
                            aria-label={playingVoiceClipId === clip.id ? t('暂停试听') : t('试听')}
                            disabled={!clip.audioUrl}
                            onClick={() => toggleVoicePlayback(clip)}
                          >
                            <Icon
                              icon={playingVoiceClipId === clip.id ? 'lucide:pause' : 'lucide:play'}
                              width="13"
                              height="13"
                              aria-hidden="true"
                            />
                          </button>
                          <span className="character-voice-chip-copy">
                            <strong>{voiceClipTitle(clip)}</strong>
                            <span>
                              {CHARACTER_VOICE_KIND_LABELS[clip.kind]} · {formatVoiceDuration(clip.durationSec)}
                            </span>
                          </span>
                          <span className="character-voice-chip-actions">
                            <button
                              type="button"
                              data-tooltip={t('设为主音色')}
                              aria-label={t('设为主音色')}
                              className={clip.id === selectedCharacter.primaryVoiceClipId ? 'is-active' : ''}
                              onClick={() => void setCharacterPrimaryVoice(scope, selectedCharacter.id, clip.id)}
                            >
                              <Icon icon="lucide:star" width="13" height="13" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              data-tooltip={t('用这个声音生成台词')}
                              aria-label={t('用这个声音生成台词')}
                              onClick={() => handleVoiceOver(clip)}
                            >
                              <Icon icon="lucide:mic" width="13" height="13" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              data-tooltip={clip.sourceNodeId ? t('定位画布节点') : t('添加到画布')}
                              aria-label={clip.sourceNodeId ? t('定位画布节点') : t('添加到画布')}
                              onClick={() => handleVoiceToCanvas(clip)}
                            >
                              <Icon
                                icon={clip.sourceNodeId ? 'lucide:locate-fixed' : 'lucide:square-plus'}
                                width="13"
                                height="13"
                                aria-hidden="true"
                              />
                            </button>
                            <button
                              type="button"
                              data-tooltip={t('移除该声音')}
                              aria-label={t('移除该声音')}
                              onClick={() => void handleRemoveVoiceClip(clip)}
                            >
                              <Icon icon="lucide:trash-2" width="13" height="13" aria-hidden="true" />
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="character-library-profile" aria-label={t('当前角色')}>
                  <div className="character-library-profile-copy">
                    <div className="character-library-profile-name">
                      <h3>{selectedCharacter.name}</h3>
                      {selectedCharacter.identity ? <span>{selectedCharacter.identity}</span> : null}
                      {selectedCharacter.storyRole ? <span>{selectedCharacter.storyRole}</span> : null}
                    </div>
                    <p>{selectedCharacter.summary || selectedCharacter.visualNotes || t('尚未填写角色简介')}</p>
                  </div>
                  <div className="character-library-profile-actions">
                    {selectedReference ? (
                      <button type="button" data-tooltip={canvasActionLabel} aria-label={canvasActionLabel} onClick={handleCanvasAction}>
                        <Icon icon={canvasActionIcon} width="16" height="16" aria-hidden="true" />
                      </button>
                    ) : null}
                    {sourceNode && !sourceNode.data.hiddenByCharacterLibrary ? (
                      <button
                        type="button"
                        data-tooltip={t('在画布中隐藏')}
                        aria-label={t('在画布中隐藏')}
                        onClick={() => {
                          if (setCharacterLibraryNodeHidden(sourceNode.id, true)) showToast(t('节点已隐藏'));
                        }}
                      >
                        <Icon icon="lucide:eye-off" width="16" height="16" aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-tooltip={t('从画布添加视角图')}
                      aria-label={t('从画布添加视角图')}
                      aria-expanded={pickerOpen}
                      className={pickerOpen ? 'is-active' : ''}
                      onClick={() => {
                        setVoicePickerOpen(false);
                        setPickerOpen((open) => !open);
                      }}
                    >
                      <Icon icon="lucide:image-plus" width="16" height="16" aria-hidden="true" />
                    </button>
                    <button type="button" data-tooltip={t('编辑角色')} aria-label={t('编辑角色')} onClick={() => openEditor(selectedCharacter)}>
                      <Icon icon="lucide:pencil" width="16" height="16" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      data-tooltip={scope === 'project' ? t('复制到全局资产') : t('复制到本项目')}
                      aria-label={scope === 'project' ? t('复制到全局资产') : t('复制到本项目')}
                      onClick={() => void handleCopy()}
                    >
                      <Icon icon="lucide:copy-plus" width="16" height="16" aria-hidden="true" />
                    </button>
                    <button type="button" data-tooltip={t('删除角色')} aria-label={t('删除角色')} onClick={() => setDeleteConfirmOpen(true)}>
                      <Icon icon="lucide:trash-2" width="16" height="16" aria-hidden="true" />
                    </button>
                  </div>
                </section>
              </div>

              <audio
                ref={voicePlayerRef}
                className="sr-only"
                onPause={() => setPlayingVoice(null)}
                onEnded={() => setPlayingVoice(null)}
              />
            </section>
          ) : (
            <div className="character-library-empty">
              <Icon icon="lucide:contact-round" width="34" height="34" aria-hidden="true" />
              <h3>{search ? t('没有匹配的角色') : t('这里还没有角色')}</h3>
              {!search ? (
                <button type="button" className="character-button-primary mt-3 text-white" onClick={() => openEditor(null)}>
                  <Icon icon="lucide:plus" width="15" height="15" aria-hidden="true" />
                  {t('新建角色')}
                </button>
              ) : null}
            </div>
          )}
        </main>

        <footer className="character-library-strip" aria-label={t('角色列表')}>
          <div className="character-library-strip-label">
            <span>{scope === 'project' ? t('本项目角色') : t('全局角色')}</span>
            <strong>{characters.length}</strong>
          </div>
          <div className="character-library-strip-list" role="list">
            {characters.map((character) => (
              <button
                key={character.id}
                type="button"
                role="listitem"
                className={character.id === selectedCharacter?.id ? 'is-selected' : ''}
                onClick={() => {
                  setSelectedCharacterId(character.id);
                  setSelectedReferenceId(null);
                }}
              >
                <CharacterAvatar character={character} />
                <span>{character.name}</span>
              </button>
            ))}
          </div>
        </footer>
      </ModalOverlay>

      {dialogOpen ? createPortal(
        <CharacterAssetDialog
          isOpen
          scope={scope}
          character={dialogCharacter}
          initialReferenceId={dialogReferenceId}
          onClose={() => setDialogOpen(false)}
          onSaved={(characterId) => {
            setSelectedCharacterId(characterId);
            setSelectedReferenceId(null);
          }}
        />,
        document.body,
      ) : null}

      {deleteConfirmOpen && selectedCharacter ? createPortal(
        <ModalOverlay
          isOpen
          onClose={() => setDeleteConfirmOpen(false)}
          ariaLabel={t('确认删除角色')}
          className="character-confirm-dialog"
          motionPreset="quick"
        >
          <div className="character-confirm-body">
            <span className="character-confirm-icon" aria-hidden="true">
              <Icon icon="lucide:trash-2" width="18" height="18" />
            </span>
            <div>
              <h3>{t('删除「{name}」？', { name: selectedCharacter.name })}</h3>
              <p>
                {scope === 'project'
                  ? t('将从本项目移除该角色及其 {count} 张参考图，画布上被收纳的节点会重新显示。', { count: selectedCharacter.referenceImages?.length ?? 0 })
                  : t('将从全局资产永久删除该角色及其 {count} 张参考图，删除后无法恢复。', { count: selectedCharacter.referenceImages?.length ?? 0 })}
              </p>
            </div>
          </div>
          <footer className="character-dialog-footer">
            <button type="button" className="character-button-secondary" onClick={() => setDeleteConfirmOpen(false)}>
              {t('取消')}
            </button>
            <button type="button" className="character-button-danger" onClick={() => void handleDelete()}>
              {t('删除角色')}
            </button>
          </footer>
        </ModalOverlay>,
        document.body,
      ) : null}

      {captureNodeId ? createPortal(
        <CharacterAssetDialog
          isOpen
          sourceNodeId={captureNodeId}
          initialScope={scope}
          initialCharacterId={selectedCharacter?.id}
          onClose={() => setCaptureNodeId(null)}
        />,
        document.body,
      ) : null}
    </>
  );
}
