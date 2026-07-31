/**
 * ComfyUI 历史输出的结构与取件地址拼接。
 *
 * 正常生成（comfyWorkflowService）和重启后的恢复轮询（pollManager）解析的是
 * 同一份 /history 输出，这里是两条路径共用的唯一定义，避免各自复制一份后跑偏。
 */

export interface ComfyOutputFile {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyOutputNode {
  images?: ComfyOutputFile[];
  videos?: ComfyOutputFile[];
  gifs?: ComfyOutputFile[];
  audios?: ComfyOutputFile[];
}

export type ComfyOutputs = Record<string, ComfyOutputNode>;

/** 把 /history 输出里的文件拼成可直接下载的 /view 地址。 */
export function buildComfyFileUrl(baseUrl: string, file: ComfyOutputFile): string {
  const subfolder = file.subfolder ? `&subfolder=${encodeURIComponent(file.subfolder)}` : '';
  const type = file.type ? `&type=${encodeURIComponent(file.type)}` : '&type=output';
  return `${baseUrl}/view?filename=${encodeURIComponent(file.filename)}${subfolder}${type}`;
}
