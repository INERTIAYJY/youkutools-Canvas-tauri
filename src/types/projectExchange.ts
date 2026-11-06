/** 项目包协作协议；这里只保存逻辑身份、业务 JSON 与内容摘要。 */
export type ProjectExchangeValue = null | boolean | number | string | ProjectExchangeValue[] | ProjectExchangeObject;
export interface ProjectExchangeObject { [key: string]: ProjectExchangeValue }

export type ProjectExchangeEntityKind = 'project' | 'node' | 'edge' | 'group' | 'character' | 'scene' | 'prop'
  | 'referenceImage' | 'voiceClip' | 'action' | 'actionMedia' | 'shot' | 'file' | 'imageMetadata';

export interface ProjectExchangeReference {
  kind: ProjectExchangeEntityKind;
  /** 逻辑项目/分集身份，不是本机 projectId。 */
  scopeId: string;
  id: string;
}
export interface ProjectExchangeEntity extends ProjectExchangeReference {
  data: ProjectExchangeObject;
  /** 由领域适配器列出引用，完整快照内必须可解析。 */
  references: ProjectExchangeReference[];
}
export interface ProjectExchangeMedia {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  extension: string;
  bytes: number;
  /** 标准整文件 SHA-256；不能放本地链式 contentDigest。 */
  sha256: string;
}
export interface ProjectExchangeSnapshot {
  format: 'ai-canvas-project-snapshot';
  canonicalVersion: 1;
  lineageId: string;
  rootProjectId: string;
  /** 缺失/截断的材料不能借实体缺失传播删除。 */
  complete: true;
  entities: ProjectExchangeEntity[];
  media: ProjectExchangeMedia[];
}
export interface ProjectExchangeRevisionHeader {
  lineageId: string;
  canonicalVersion: 1;
  revisionId: string;
  parentRevisionIds: string[];
  contentDigest: string;
}
export interface ProjectExchangeRevision extends ProjectExchangeRevisionHeader {
  snapshot: ProjectExchangeSnapshot;
}
export type ProjectExchangeStoredRevision = ProjectExchangeRevisionHeader & { snapshot?: ProjectExchangeSnapshot };
export interface ProjectExchangeArchiveFile {
  mediaId: string;
  /** 仅允许 assets/ 内的安全归档相对路径，不能用作本机输出路径。 */
  archivePath: string;
}
export interface ProjectExchangeBundle {
  format: 'ai-canvas-project-exchange';
  version: 1;
  packageId: string;
  lineageId: string;
  headRevisionId: string;
  /** 当前版本与所需锚点正文。祖先可只有有界的版本描述。 */
  revisions: ProjectExchangeRevision[];
  ancestors: ProjectExchangeRevisionHeader[];
  files: ProjectExchangeArchiveFile[];
}
export interface ProjectExchangeIdentity extends ProjectExchangeReference {
  localId: string;
}
export interface ProjectExchangeState {
  ownerId: string;
  lineageId: string;
  rootProjectId: string;
  headRevisionId: string;
  /** 仅协作映射 CAS 版本；不是项目正文的持久化写入 epoch。 */
  stateVersion: number;
  identities: ProjectExchangeIdentity[];
}
export type ProjectExchangeBaseResult =
  | { status: 'found'; revision: ProjectExchangeRevision }
  | { status: 'unrelated' | 'incomplete' | 'ambiguous' | 'missingSnapshot' };
