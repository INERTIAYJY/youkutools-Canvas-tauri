import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Icon } from '@iconify/react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, generateId } from '../store/useAppStore';
import { normalizeAssetKey } from '../services/dramaAssetExtract';
import type {
  CharacterCropRect,
  CharacterReferenceImage,
  CharacterReferenceKind,
  DramaCharacter,
} from '../types/dramaAssets';
import ModalOverlay from './shared/ModalOverlay';
import PopupCloseButton from './shared/PopupCloseButton';
import {
  CHARACTER_REFERENCE_KIND_LABELS,
  cropImageStyle,
} from './character/characterReferencePresentation';

type CharacterLibraryScope = 'project' | 'global';

const REFERENCE_KINDS = Object.entries(CHARACTER_REFERENCE_KIND_LABELS) as Array<[
  CharacterReferenceKind,
  string,
]>;

function createEmptyCharacter(): DramaCharacter {
  const now = Date.now();
  return {
    id: `character-${generateId()}`,
    kind: 'character',
    name: '',
    key: '',
    identity: '',
    summary: '',
    visualNotes: '',
    importance: 'supporting',
    confirmed: true,
    createdAt: now,
    updatedAt: now,
    source: 'manual',
    referenceImages: [],
  };
}

function cloneCharacter(character: DramaCharacter): DramaCharacter {
  return {
    ...character,
    relationships: character.relationships?.map((relationship) => ({ ...relationship })),
    referenceImages: character.referenceImages?.map((reference) => ({ ...reference })) ?? [],
    avatarCrop: character.avatarCrop ? { ...character.avatarCrop } : undefined,
  };
}

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('图片读取失败'));
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function AvatarCropEditor({
  reference,
  crop,
  onChange,
}: {
  reference: CharacterReferenceImage;
  crop?: CharacterCropRect;
  onChange: (crop: CharacterCropRect) => void;
}) {
  const [ratio, setRatio] = useState(1);
  const [zoom, setZoom] = useState(1.35);
  const [focusX, setFocusX] = useState(0.5);
  const [focusY, setFocusY] = useState(0.38);
  const initializedFor = useRef<string | null>(null);

  const makeCrop = (nextZoom: number, nextX: number, nextY: number, imageRatio = ratio) => {
    const baseWidth = imageRatio >= 1 ? 1 / imageRatio : 1;
    const baseHeight = imageRatio >= 1 ? 1 : imageRatio;
    const width = clamp(baseWidth / nextZoom, 0.04, 1);
    const height = clamp(baseHeight / nextZoom, 0.04, 1);
    return {
      x: clamp(nextX * (1 - width), 0, 1 - width),
      y: clamp(nextY * (1 - height), 0, 1 - height),
      width,
      height,
    };
  };

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const nextRatio = image.naturalWidth / Math.max(1, image.naturalHeight);
    setRatio(nextRatio);
    if (initializedFor.current === reference.id) return;
    initializedFor.current = reference.id;

    if (crop) {
      const baseWidth = nextRatio >= 1 ? 1 / nextRatio : 1;
      const baseHeight = nextRatio >= 1 ? 1 : nextRatio;
      setZoom(clamp(Math.min(baseWidth / crop.width, baseHeight / crop.height), 1, 3));
      setFocusX(crop.width >= 1 ? 0.5 : crop.x / (1 - crop.width));
      setFocusY(crop.height >= 1 ? 0.5 : crop.y / (1 - crop.height));
      return;
    }
    onChange(makeCrop(1.35, 0.5, 0.38, nextRatio));
  };

  const changeCrop = (nextZoom = zoom, nextX = focusX, nextY = focusY) => {
    setZoom(nextZoom);
    setFocusX(nextX);
    setFocusY(nextY);
    onChange(makeCrop(nextZoom, nextX, nextY));
  };

  return (
    <div className="character-crop-editor">
      <div className="character-crop-preview" aria-label="头像裁切预览">
        {reference.imageUrl ? (
          <img
            src={reference.imageUrl}
            alt=""
            draggable={false}
            onLoad={handleImageLoad}
            style={cropImageStyle(crop)}
          />
        ) : null}
        <span className="character-crop-frame" aria-hidden="true" />
      </div>
      <div className="character-crop-controls">
        <label>
          <span>水平</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={focusX}
            onChange={(event) => changeCrop(zoom, Number(event.target.value), focusY)}
          />
        </label>
        <label>
          <span>垂直</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={focusY}
            onChange={(event) => changeCrop(zoom, focusX, Number(event.target.value))}
          />
        </label>
        <label>
          <span>缩放</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => changeCrop(Number(event.target.value), focusX, focusY)}
          />
        </label>
      </div>
    </div>
  );
}

interface CharacterAssetDialogProps {
  isOpen: boolean;
  scope: CharacterLibraryScope;
  character: DramaCharacter | null;
  initialReferenceId?: string | null;
  onClose: () => void;
  onSaved: (characterId: string) => void;
}

export default function CharacterAssetDialog({
  isOpen,
  scope,
  character,
  initialReferenceId,
  onClose,
  onSaved,
}: CharacterAssetDialogProps) {
  const { saveCharacterCard, showToast } = useAppStore(
    useShallow((state) => ({
      saveCharacterCard: state.saveCharacterCard,
      showToast: state.showToast,
    })),
  );
  const initialDraft = useMemo(
    () => character ? cloneCharacter(character) : createEmptyCharacter(),
    [character],
  );
  const [draft, setDraft] = useState<DramaCharacter>(initialDraft);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(
    initialReferenceId
    ?? initialDraft.primaryReferenceImageId
    ?? initialDraft.referenceImages?.[0]?.id
    ?? null,
  );
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedReference = useMemo(
    () => draft.referenceImages?.find((reference) => reference.id === selectedReferenceId) ?? null,
    [draft.referenceImages, selectedReferenceId],
  );

  const patchDraft = (patch: Partial<DramaCharacter>) => {
    setDraft((current) => ({ ...current, ...patch, updatedAt: Date.now() }));
  };

  const patchReference = (patch: Partial<CharacterReferenceImage>) => {
    if (!selectedReferenceId) return;
    setDraft((current) => ({
      ...current,
      updatedAt: Date.now(),
      referenceImages: (current.referenceImages ?? []).map((reference) =>
        reference.id === selectedReferenceId
          ? { ...reference, ...patch, updatedAt: Date.now() }
          : reference,
      ),
    }));
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const shouldAssignPrimary = !draft.primaryReferenceImageId;
    event.target.value = '';
    if (files.length === 0) return;
    try {
      const now = Date.now();
      const references = await Promise.all(files.map(async (file, index) => ({
        id: `reference-${generateId()}`,
        kind: shouldAssignPrimary && index === 0 ? 'primary' as const : 'other' as const,
        imageUrl: await readImageFile(file),
        prompt: '',
        createdAt: now + index,
        updatedAt: now + index,
      })));
      setDraft((current) => {
        const nextReferences = [...(current.referenceImages ?? []), ...references];
        return {
          ...current,
          referenceImages: nextReferences,
          primaryReferenceImageId: current.primaryReferenceImageId ?? references[0]?.id,
          updatedAt: Date.now(),
        };
      });
      setSelectedReferenceId(references[0]?.id ?? null);
    } catch {
      showToast('图片读取失败', 'error');
    }
  };

  const removeSelectedReference = () => {
    if (!selectedReferenceId) return;
    const rest = (draft.referenceImages ?? []).filter(
      (reference) => reference.id !== selectedReferenceId,
    );
    patchDraft({
      referenceImages: rest,
      primaryReferenceImageId: draft.primaryReferenceImageId === selectedReferenceId
        ? rest[0]?.id
        : draft.primaryReferenceImageId,
      avatarReferenceImageId: draft.avatarReferenceImageId === selectedReferenceId
        ? undefined
        : draft.avatarReferenceImageId,
      avatarCrop: draft.avatarReferenceImageId === selectedReferenceId
        ? undefined
        : draft.avatarCrop,
    });
    setSelectedReferenceId(rest[0]?.id ?? null);
  };

  const handleSave = async () => {
    const name = draft.name.trim();
    if (!name) {
      showToast('请填写角色名称', 'error');
      return;
    }
    setSaving(true);
    const references = draft.referenceImages ?? [];
    const primaryReference = references.find(
      (reference) => reference.id === draft.primaryReferenceImageId,
    ) ?? references[0];
    const payload = {
      ...draft,
      name,
      key: normalizeAssetKey(name),
      referenceImages: references,
      primaryReferenceImageId: primaryReference?.id,
      imageNodeId: primaryReference?.sourceNodeId,
      imageUrl: primaryReference?.imageUrl,
      updatedAt: Date.now(),
    };
    const saved = await saveCharacterCard(scope, payload);
    setSaving(false);
    if (!saved) return;
    showToast(scope === 'project' ? '角色已保存到本项目' : '角色已永久保存');
    onSaved(payload.id);
    onClose();
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={character ? '编辑角色' : '新建角色'}
      className="character-dialog"
    >
      <header className="character-dialog-header">
        <div>
          <h2>{character ? '编辑角色' : '新建角色'}</h2>
          <p>{scope === 'project' ? '保存到本项目' : '永久保存到角色库'}</p>
        </div>
        <PopupCloseButton onClick={onClose} />
      </header>

      <div className="character-dialog-body">
        <section className="character-dialog-fields" aria-label="角色资料">
          <label className="character-field character-field-wide">
            <span>角色名称</span>
            <input
              autoFocus
              value={draft.name}
              onChange={(event) => patchDraft({ name: event.target.value })}
              placeholder="例如：沈砚"
            />
          </label>
          <label className="character-field">
            <span>身份</span>
            <input
              value={draft.identity}
              onChange={(event) => patchDraft({ identity: event.target.value })}
              placeholder="职业或身份"
            />
          </label>
          <label className="character-field">
            <span>故事定位</span>
            <input
              value={draft.storyRole ?? ''}
              onChange={(event) => patchDraft({ storyRole: event.target.value || undefined })}
              placeholder="主角、反派、导师…"
            />
          </label>
          <label className="character-field character-field-wide">
            <span>简介</span>
            <textarea
              value={draft.summary}
              onChange={(event) => patchDraft({ summary: event.target.value })}
              rows={2}
              placeholder="角色背景与核心特征"
            />
          </label>
          <label className="character-field character-field-wide">
            <span>外观特征</span>
            <textarea
              value={draft.visualNotes}
              onChange={(event) => patchDraft({ visualNotes: event.target.value })}
              rows={2}
              placeholder="发型、五官、体态、服饰等稳定视觉特征"
            />
          </label>
          <label className="character-field">
            <span>性格</span>
            <input
              value={draft.personality ?? ''}
              onChange={(event) => patchDraft({ personality: event.target.value || undefined })}
            />
          </label>
          <label className="character-field">
            <span>默认服装</span>
            <input
              value={draft.wardrobeDefault ?? ''}
              onChange={(event) => patchDraft({ wardrobeDefault: event.target.value || undefined })}
            />
          </label>
        </section>

        <section className="character-dialog-references" aria-label="参考图">
          <div className="character-reference-toolbar">
            <div>
              <h3>参考图</h3>
              <span>{draft.referenceImages?.length ?? 0} 张</span>
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              <Icon icon="lucide:images" width="15" height="15" aria-hidden="true" />
              添加图片
            </button>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => void handleFiles(event)}
            />
          </div>

          <div className="character-dialog-reference-strip" role="list" aria-label="已添加图片">
            {(draft.referenceImages ?? []).map((reference, index) => (
              <button
                key={reference.id}
                type="button"
                role="listitem"
                className={reference.id === selectedReferenceId ? 'is-selected' : ''}
                onClick={() => setSelectedReferenceId(reference.id)}
                aria-label={`第 ${index + 1} 张，${CHARACTER_REFERENCE_KIND_LABELS[reference.kind]}`}
              >
                {reference.imageUrl ? <img src={reference.imageUrl} alt="" /> : null}
              </button>
            ))}
            {(draft.referenceImages?.length ?? 0) === 0 ? (
              <button
                type="button"
                className="character-reference-add-empty"
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon icon="lucide:plus" width="20" height="20" aria-hidden="true" />
                <span>添加多张角色参考图</span>
              </button>
            ) : null}
          </div>

          {selectedReference ? (
            <div className="character-reference-editor">
              <div className="character-reference-editor-main">
                <div className="character-reference-editor-image">
                  {selectedReference.imageUrl ? <img src={selectedReference.imageUrl} alt="" /> : null}
                </div>
                <div className="character-reference-editor-fields">
                  <label className="character-field">
                    <span>图片用途</span>
                    <select
                      value={selectedReference.kind}
                      onChange={(event) => patchReference({
                        kind: event.target.value as CharacterReferenceKind,
                      })}
                    >
                      {REFERENCE_KINDS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="character-field">
                    <span>图片提示词</span>
                    <textarea
                      value={selectedReference.prompt}
                      onChange={(event) => patchReference({ prompt: event.target.value })}
                      rows={4}
                      placeholder="记录生成该形象时使用的提示词"
                    />
                  </label>
                  <div className="character-reference-actions">
                    <button
                      type="button"
                      className={draft.primaryReferenceImageId === selectedReference.id ? 'is-active' : ''}
                      onClick={() => patchDraft({ primaryReferenceImageId: selectedReference.id })}
                    >
                      <Icon icon="lucide:star" width="14" height="14" aria-hidden="true" />
                      主视觉
                    </button>
                    <button
                      type="button"
                      className={draft.avatarReferenceImageId === selectedReference.id ? 'is-active' : ''}
                      onClick={() => patchDraft({
                        avatarReferenceImageId: selectedReference.id,
                        avatarCrop: draft.avatarReferenceImageId === selectedReference.id
                          ? draft.avatarCrop
                          : undefined,
                      })}
                    >
                      <Icon icon="lucide:scan-face" width="14" height="14" aria-hidden="true" />
                      设为头像
                    </button>
                    <button type="button" className="is-danger" onClick={removeSelectedReference}>
                      <Icon icon="lucide:trash-2" width="14" height="14" aria-hidden="true" />
                      移除
                    </button>
                  </div>
                </div>
              </div>

              {draft.avatarReferenceImageId === selectedReference.id ? (
                <AvatarCropEditor
                  key={selectedReference.id}
                  reference={selectedReference}
                  crop={draft.avatarCrop}
                  onChange={(avatarCrop) => patchDraft({ avatarCrop })}
                />
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <footer className="character-dialog-footer">
        <button type="button" className="character-button-secondary" onClick={onClose}>取消</button>
        <button
          type="button"
          className="character-button-primary text-white"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? '保存中…' : '保存角色'}
        </button>
      </footer>
    </ModalOverlay>
  );
}
