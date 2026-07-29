/**
 * 角色声音片段的浏览器侧读取工具：本地音频转 data URL、读取时长。
 * 落盘与全局资产归档在 services/characterLibraryService.ts。
 */

export function readAudioFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('音频读取失败'));
    reader.onerror = () => reject(reader.error ?? new Error('音频读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 读取音频时长；解码失败时返回 undefined，不阻断绑定流程。 */
export function readAudioDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const finish = (duration?: number) => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      resolve(duration);
    };
    audio.onloadedmetadata = () => finish(
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined,
    );
    audio.onerror = () => finish(undefined);
    audio.preload = 'metadata';
    audio.src = url;
  });
}
