import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import type { CharacterReferenceImage, DramaCharacter } from '../types/dramaAssets';
import ModalOverlay from './shared/ModalOverlay';
import PopupCloseButton from './shared/PopupCloseButton';
import CharacterAssetDialog from './CharacterAssetDialog';
import CharacterReferenceGallery from './character/CharacterReferenceGallery';
import { cropImageStyle } from './character/characterReferencePresentation';

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
    restoreCharacterLibraryNode,
    createImageNodeFromCharacterReference,
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
      restoreCharacterLibraryNode: state.restoreCharacterLibraryNode,
      createImageNodeFromCharacterReference: state.createImageNodeFromCharacterReference,
      setSelectedNodeIds: state.setSelectedNodeIds,
      showToast: state.showToast,
    })),
  );
  const [scope, setScope] = useState<CharacterLibraryScope>('project');
  const [search, setSearch] = useState('');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCharacter, setDialogCharacter] = useState<DramaCharacter | null>(null);
  const [dialogReferenceId, setDialogReferenceId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [captureNodeId, setCaptureNodeId] = useState<string | null>(null);

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
      ? '显示并定位节点'
      : '定位画布节点'
    : '添加到画布';
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

  const switchScope = (nextScope: CharacterLibraryScope) => {
    setScope(nextScope);
    setSelectedCharacterId(null);
    setSelectedReferenceId(null);
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
      showToast('已复制到全局资产');
      setScope('global');
      setSelectedCharacterId(copiedId);
      setSelectedReferenceId(null);
      return;
    }
    const copiedId = copyGlobalCharacterToProject(selectedCharacter.id);
    if (!copiedId) return;
    showToast('已复制到本项目');
    setScope('project');
    setSelectedCharacterId(copiedId);
    setSelectedReferenceId(null);
  };

  const handleDelete = async () => {
    if (!selectedCharacter) return;
    const target = scope === 'project' ? '本项目' : '全局资产';
    if (!window.confirm(`从${target}删除「${selectedCharacter.name}」？`)) return;
    if (scope === 'project') {
      deleteDramaAsset('character', selectedCharacter.id);
    } else if (!await deleteGlobalCharacter(selectedCharacter.id)) {
      return;
    }
    showToast('角色已删除');
    setSelectedCharacterId(null);
    setSelectedReferenceId(null);
  };

  const handleCanvasAction = () => {
    if (!selectedCharacter || !selectedReference) return;
    let nodeId = sourceNode?.id ?? null;
    if (sourceNode?.data.hiddenByCharacterLibrary) {
      restoreCharacterLibraryNode(sourceNode.id);
      showToast('节点已显示');
    } else if (!sourceNode) {
      nodeId = createImageNodeFromCharacterReference(
        scope,
        selectedCharacter.id,
        selectedReference.id,
      );
      if (!nodeId) return;
      showToast('已将角色参考图添加到画布');
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
        ariaLabel="角色库"
        className="character-library-panel"
      >
        <div className="character-library-toolbar">
          <div className="character-library-tabs" role="tablist" aria-label="角色保存范围">
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'project'}
              className={scope === 'project' ? 'is-active' : ''}
              onClick={() => switchScope('project')}
            >
              本项目
              <span>{projectCharacters.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'global'}
              className={scope === 'global' ? 'is-active' : ''}
              onClick={() => switchScope('global')}
            >
              全局资产
              <span>{globalCharacters.length}</span>
            </button>
          </div>
          <label className="character-library-search">
            <Icon icon="lucide:search" width="15" height="15" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索角色、身份或简介"
            />
            {search ? (
              <button type="button" aria-label="清空搜索" onClick={() => setSearch('')}>
                <Icon icon="lucide:x" width="13" height="13" aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <button type="button" className="character-library-new" onClick={() => openEditor(null)}>
            <Icon icon="lucide:plus" width="13" height="13" aria-hidden="true" />
            新建角色
          </button>
          <PopupCloseButton onClick={() => setOpen(false)} />
        </div>

        <main className="character-library-content">
          {scope === 'global' && globalCharactersLoading ? (
            <div className="character-library-empty">
              <Icon icon="lucide:loader-circle" className="animate-spin" width="26" height="26" aria-hidden="true" />
              <p>正在读取全局角色…</p>
            </div>
          ) : selectedCharacter ? (
            <section className="character-library-gallery" aria-label="多图参考">
              <CharacterReferenceGallery
                references={selectedCharacter.referenceImages ?? []}
                selectedId={effectiveReferenceId}
                onSelect={setSelectedReferenceId}
                onEdit={(referenceId) => openEditor(selectedCharacter, referenceId)}
              />

              <section className="character-library-profile" aria-label="当前角色">
                <div className="character-library-profile-copy">
                  <div className="character-library-profile-name">
                    <h3>{selectedCharacter.name}</h3>
                    {selectedCharacter.identity ? <span>{selectedCharacter.identity}</span> : null}
                    {selectedCharacter.storyRole ? <span>{selectedCharacter.storyRole}</span> : null}
                  </div>
                  <p>{selectedCharacter.summary || selectedCharacter.visualNotes || '尚未填写角色简介'}</p>
                </div>
                <div className="character-library-profile-actions">
                  {selectedReference ? (
                    <button type="button" data-tooltip={canvasActionLabel} aria-label={canvasActionLabel} onClick={handleCanvasAction}>
                      <Icon icon={canvasActionIcon} width="16" height="16" aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-tooltip="从画布添加视角图"
                    aria-label="从画布添加视角图"
                    aria-expanded={pickerOpen}
                    className={pickerOpen ? 'is-active' : ''}
                    onClick={() => setPickerOpen((open) => !open)}
                  >
                    <Icon icon="lucide:image-plus" width="16" height="16" aria-hidden="true" />
                  </button>
                  <button type="button" data-tooltip="编辑角色" aria-label="编辑角色" onClick={() => openEditor(selectedCharacter)}>
                    <Icon icon="lucide:pencil" width="16" height="16" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    data-tooltip={scope === 'project' ? '复制到全局资产' : '复制到本项目'}
                    aria-label={scope === 'project' ? '复制到全局资产' : '复制到本项目'}
                    onClick={() => void handleCopy()}
                  >
                    <Icon icon="lucide:copy-plus" width="16" height="16" aria-hidden="true" />
                  </button>
                  <button type="button" data-tooltip="删除角色" aria-label="删除角色" onClick={() => void handleDelete()}>
                    <Icon icon="lucide:trash-2" width="16" height="16" aria-hidden="true" />
                  </button>
                </div>
              </section>

              {pickerOpen ? (
                <div className="character-node-picker" role="listbox" aria-label="选择画布图片节点">
                  {pickableNodes.length === 0 ? (
                    <span className="character-node-picker-empty">画布上没有可用的图片节点</span>
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
                      <span>{node.data.label || '图片节点'}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : (
            <div className="character-library-empty">
              <Icon icon="lucide:contact-round" width="34" height="34" aria-hidden="true" />
              <h3>{search ? '没有匹配的角色' : '这里还没有角色'}</h3>
              {!search ? (
                <button type="button" className="character-button-primary mt-3 text-white" onClick={() => openEditor(null)}>
                  <Icon icon="lucide:plus" width="15" height="15" aria-hidden="true" />
                  新建角色
                </button>
              ) : null}
            </div>
          )}
        </main>

        <footer className="character-library-strip" aria-label="角色列表">
          <div className="character-library-strip-label">
            <span>{scope === 'project' ? '本项目角色' : '全局角色'}</span>
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
