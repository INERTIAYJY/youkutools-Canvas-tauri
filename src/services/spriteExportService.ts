/**
 * spriteExportService — Sprite Sheet 切帧导出
 * 弹保存对话框，由用户选的扩展名决定格式：.gif 出动图，.png 出序列帧。
 */
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

export interface SpriteExportResult {
  files: string[];
  frame_width: number;
  frame_height: number;
}

export interface SpriteExportOptions {
  inputPath: string;
  defaultName: string;
  cols: number;
  rows: number;
  frameCount: number;
  fps: number;
}

/** 用户取消对话框时返回 null。 */
export async function exportSpriteFrames(
  options: SpriteExportOptions,
): Promise<SpriteExportResult | null> {
  const safeName = options.defaultName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'sprite';
  const outputPath = await save({
    defaultPath: `${safeName}.gif`,
    filters: [
      { name: 'GIF 动图', extensions: ['gif'] },
      { name: 'PNG 序列帧', extensions: ['png'] },
    ],
  });
  if (!outputPath) return null;

  const json: string = await invoke('export_sprite_frames', {
    inputPath: options.inputPath,
    outputPath,
    cols: options.cols,
    rows: options.rows,
    frameCount: options.frameCount,
    fps: options.fps,
  });
  return JSON.parse(json) as SpriteExportResult;
}
