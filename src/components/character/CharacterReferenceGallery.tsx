import { Icon } from '@iconify/react';
import type { CharacterCropRect, CharacterReferenceImage } from '../../types/dramaAssets';
import {
  CHARACTER_REFERENCE_KIND_LABELS,
  cropImageStyle,
} from './characterReferencePresentation';

interface CharacterReferenceGalleryProps {
  references: CharacterReferenceImage[];
  selectedId: string | null;
  primaryReferenceImageId?: string;
  avatarReferenceImageId?: string;
  avatarCrop?: CharacterCropRect;
  onSelect: (referenceId: string) => void;
  onEdit: (referenceId: string) => void;
}

export default function CharacterReferenceGallery({
  references,
  selectedId,
  primaryReferenceImageId,
  avatarReferenceImageId,
  avatarCrop,
  onSelect,
  onEdit,
}: CharacterReferenceGalleryProps) {
  if (references.length === 0) {
    return (
      <div className="character-reference-empty">
        <Icon icon="lucide:images" width="30" height="30" aria-hidden="true" />
        <span>还没有参考图</span>
      </div>
    );
  }

  return (
    <div className="character-reference-grid" role="list" aria-label="角色参考图">
      {references.map((reference) => {
        const selected = reference.id === selectedId;
        const isAvatar = reference.id === avatarReferenceImageId;
        return (
          <button
            key={reference.id}
            type="button"
            role="listitem"
            className={`character-reference-item ${selected ? 'is-selected' : ''}`}
            onClick={() => onSelect(reference.id)}
            onDoubleClick={() => onEdit(reference.id)}
            aria-label={`${CHARACTER_REFERENCE_KIND_LABELS[reference.kind]}参考图`}
          >
            <span className="character-reference-media">
              {reference.imageUrl ? (
                <img
                  src={reference.imageUrl}
                  alt=""
                  draggable={false}
                  className={isAvatar && avatarCrop ? 'is-cropped' : ''}
                  style={isAvatar ? cropImageStyle(avatarCrop) : undefined}
                />
              ) : (
                <Icon icon="lucide:image-off" width="24" height="24" aria-hidden="true" />
              )}
            </span>
            <span className="character-reference-meta">
              <span>{CHARACTER_REFERENCE_KIND_LABELS[reference.kind]}</span>
              <span className="character-reference-badges" aria-hidden="true">
                {reference.id === primaryReferenceImageId ? (
                  <Icon icon="lucide:star" width="12" height="12" />
                ) : null}
                {isAvatar ? <Icon icon="lucide:user-round" width="12" height="12" /> : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
