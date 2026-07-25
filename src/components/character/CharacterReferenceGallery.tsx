import type { CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import type { CharacterReferenceImage } from '../../types/dramaAssets';
import { CHARACTER_REFERENCE_KIND_LABELS } from './characterReferencePresentation';

interface CharacterReferenceGalleryProps {
  references: CharacterReferenceImage[];
  selectedId: string | null;
  onSelect: (referenceId: string) => void;
  onEdit: (referenceId: string) => void;
}

export default function CharacterReferenceGallery({
  references,
  selectedId,
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

  // ponytail: 方阵近似，够把所有图塞进一屏；真要按图片宽高比排版再算
  const columns = Math.ceil(Math.sqrt(references.length));
  const gridSize = { '--cols': columns, '--rows': Math.ceil(references.length / columns) } as CSSProperties;

  return (
    <div className="character-reference-grid" role="list" aria-label="角色参考图" style={gridSize}>
      {references.map((reference) => (
        <button
          key={reference.id}
          type="button"
          role="listitem"
          className={`character-reference-item ${reference.id === selectedId ? 'is-selected' : ''}`}
          onClick={() => onSelect(reference.id)}
          onDoubleClick={() => onEdit(reference.id)}
          aria-label={`${CHARACTER_REFERENCE_KIND_LABELS[reference.kind]}参考图`}
        >
          <span className="character-reference-media">
            {reference.imageUrl ? (
              <img src={reference.imageUrl} alt="" draggable={false} />
            ) : (
              <Icon icon="lucide:image-off" width="24" height="24" aria-hidden="true" />
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
