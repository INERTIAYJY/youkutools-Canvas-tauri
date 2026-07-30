import { memo } from 'react';
import type { CanvasNoteData } from '../../types';

interface CanvasNoteImageProps {
  note: CanvasNoteData;
  imageUrl?: string;
  label: string;
}

function CanvasNoteImage({ note, imageUrl, label }: CanvasNoteImageProps) {
  if (!imageUrl) {
    return <div className="canvas-note-image-missing">图片不可用</div>;
  }
  return (
    <img
      className={`canvas-note-image canvas-note-image--${note.style.roundness}`}
      src={imageUrl}
      alt={label}
      draggable={false}
    />
  );
}

export default memo(CanvasNoteImage);
