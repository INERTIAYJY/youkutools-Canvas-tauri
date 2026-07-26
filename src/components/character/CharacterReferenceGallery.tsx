import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import type { CharacterReferenceImage } from '../../types/dramaAssets';
import { CHARACTER_REFERENCE_KIND_LABELS } from './characterReferencePresentation';
import { justifiedRows } from './justifiedRows';

const GAP = 8;

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [ratios, setRatios] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [references.length]);

  // 图片可能被替换，清掉已经不存在的比例，避免旧值影响排版
  useEffect(() => {
    setRatios((previous) => {
      const alive = Object.fromEntries(
        Object.entries(previous).filter(([id]) => references.some((item) => item.id === id)),
      );
      return Object.keys(alive).length === Object.keys(previous).length ? previous : alive;
    });
  }, [references]);

  const layout = useMemo(
    // 比例未知的先按 1 排，onLoad 拿到真实尺寸后自动重排
    () => justifiedRows(references.map((item) => ratios[item.id] ?? 1), box.width, box.height, GAP),
    [box.height, box.width, ratios, references],
  );

  if (references.length === 0) {
    return (
      <div className="character-reference-empty">
        <Icon icon="lucide:images" width="30" height="30" aria-hidden="true" />
        <span>还没有参考图</span>
      </div>
    );
  }

  return (
    <div className="character-reference-grid" role="list" aria-label="角色参考图" ref={containerRef}>
      {layout?.rows.map((row, rowIndex) => (
        <div
          className="character-reference-row"
          key={row.items.join('-') || rowIndex}
          style={{ width: layout.width, height: row.height }}
        >
          {row.items.map((index) => {
            const reference = references[index];
            return (
              <button
                key={reference.id}
                type="button"
                role="listitem"
                className={`character-reference-item ${reference.id === selectedId ? 'is-selected' : ''}`}
                style={{ flex: `${ratios[reference.id] ?? 1} 1 0` }}
                onClick={() => onSelect(reference.id)}
                onDoubleClick={() => onEdit(reference.id)}
                aria-label={`${CHARACTER_REFERENCE_KIND_LABELS[reference.kind]}参考图`}
              >
                {reference.imageUrl ? (
                  <img
                    src={reference.imageUrl}
                    alt=""
                    draggable={false}
                    onLoad={(event) => {
                      const { naturalWidth, naturalHeight } = event.currentTarget;
                      if (!naturalWidth || !naturalHeight) return;
                      const ratio = naturalWidth / naturalHeight;
                      setRatios((previous) => (
                        previous[reference.id] === ratio
                          ? previous
                          : { ...previous, [reference.id]: ratio }
                      ));
                    }}
                  />
                ) : (
                  <Icon icon="lucide:image-off" width="24" height="24" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
