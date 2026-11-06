/**
 * volcengineAssetLibrary — 请求方舟素材分组、素材列表与详情。
 */
import { parseResponseError } from '../httpUtils';
import { corsSafeFetch } from '../httpTransport';
import { signVolcengineRequest } from './volcengineSigner';
import type { VolcengineAsset, VolcengineAssetGroup } from '../../../types/volcengineAssetLibrary';

export interface AssetLibraryRequestOptions { accessKeyId: string; secretAccessKey: string; projectName?: string; baseUrl?: string; region?: string; signal?: AbortSignal }
export interface VolcenginePage<T> { items: T[]; nextToken?: string; pageNumber?: number; pageSize?: number; totalCount?: number }
const DEFAULT_ENDPOINT = 'https://ark.cn-beijing.volcengineapi.com/';
function endpoint(action: string, baseUrl = DEFAULT_ENDPOINT): string { const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`); url.searchParams.set('Action', action); url.searchParams.set('Version', '2024-01-01'); return url.toString(); }
async function request<T>(action: string, options: AssetLibraryRequestOptions, body: Record<string, unknown>): Promise<T> {
  const url = endpoint(action, options.baseUrl);
  const rawBody = JSON.stringify(body);
  // 方舟 Assets API 仅支持 AK/SK Signature V4 鉴权，使用官方签名器生成 Authorization。
  const signed = await signVolcengineRequest({ method: 'POST', url, body: rawBody, accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, region: options.region });
  const response = await corsSafeFetch(url, { method: 'POST', headers: signed.headers, body: rawBody, signal: options.signal });
  if (!response.ok) await parseResponseError(response, `方舟素材库请求失败 (${response.status})`);
  return response.json() as Promise<T>;
}
function project(options: AssetLibraryRequestOptions): string { return options.projectName?.trim() || 'default'; }
function unwrapPage<T>(value: unknown, key: string): VolcenginePage<T> { const result = value && typeof value === 'object' ? ((value as Record<string, unknown>).Result ?? value) : null; const record = result && typeof result === 'object' ? result as Record<string, unknown> : {}; const items = record[key]; return { items: Array.isArray(items) ? items as T[] : [], nextToken: typeof record.NextToken === 'string' ? record.NextToken : undefined, pageNumber: typeof record.PageNumber === 'number' ? record.PageNumber : undefined, pageSize: typeof record.PageSize === 'number' ? record.PageSize : undefined, totalCount: typeof record.TotalCount === 'number' ? record.TotalCount : undefined }; }
function unwrapOne<T>(value: unknown): T { return ((value as Record<string, unknown>).Result ?? value) as T; }
function group(value: Record<string, unknown>): VolcengineAssetGroup { return { id: String(value.Id ?? value.id ?? ''), name: String(value.Name ?? value.name ?? ''), description: String(value.Description ?? value.description ?? ''), status: String(value.Status ?? value.status ?? ''), createdAt: String(value.CreateTime ?? value.createdAt ?? ''), updatedAt: String(value.UpdateTime ?? value.updatedAt ?? '') }; }
function asset(value: Record<string, unknown>): VolcengineAsset { return { id: String(value.Id ?? value.id ?? ''), groupId: String(value.GroupId ?? value.groupId ?? ''), name: String(value.Name ?? value.name ?? ''), status: String(value.Status ?? value.status ?? ''), assetType: String(value.AssetType ?? value.assetType ?? ''), thumbnailUrl: String(value.URL ?? value.thumbnailUrl ?? ''), createdAt: String(value.CreateTime ?? value.createdAt ?? ''), updatedAt: String(value.UpdateTime ?? value.updatedAt ?? '') }; }

export async function listAssetGroups(options: AssetLibraryRequestOptions, filter: { name?: string; groupIds?: string[]; pageNumber?: number; pageSize?: number } = {}): Promise<VolcenginePage<VolcengineAssetGroup>> { const page = unwrapPage<Record<string, unknown>>(await request('ListAssetGroups', options, { Filter: { GroupType: 'AIGC', ...(filter.name ? { Name: filter.name } : {}), ...(filter.groupIds ? { GroupIds: filter.groupIds } : {}) }, PageNumber: filter.pageNumber || 1, PageSize: filter.pageSize || 20, ProjectName: project(options) }), 'Items'); return { ...page, items: page.items.map(group) }; }
export async function listAssets(options: AssetLibraryRequestOptions, groupId?: string, name?: string, pageNumber = 1, pageSize = 20): Promise<VolcenginePage<VolcengineAsset>> { const page = unwrapPage<Record<string, unknown>>(await request('ListAssets', options, { Filter: { GroupType: 'AIGC', ...(groupId ? { GroupIds: [groupId] } : {}), ...(name ? { Name: name } : {}), Statuses: ['Active', 'Processing', 'Failed'] }, PageNumber: pageNumber, PageSize: pageSize, ProjectName: project(options) }), 'Items'); return { ...page, items: page.items.map(asset) }; }
export async function getAsset(options: AssetLibraryRequestOptions, id: string): Promise<VolcengineAsset> { return asset(unwrapOne(await request('GetAsset', options, { Id: id, ProjectName: project(options) }))); }
export async function getAssetGroup(options: AssetLibraryRequestOptions, id: string): Promise<VolcengineAssetGroup> { return group(unwrapOne(await request('GetAssetGroup', options, { Id: id, ProjectName: project(options) }))); }
export async function createAssetGroup(options: AssetLibraryRequestOptions, input: { name: string; description?: string }): Promise<VolcengineAssetGroup> { return group(unwrapOne(await request('CreateAssetGroup', options, { Name: input.name, Description: input.description || '', GroupType: 'AIGC', ProjectName: project(options) }))); }
export async function updateAssetGroup(options: AssetLibraryRequestOptions, id: string, input: { name?: string; description?: string }): Promise<VolcengineAssetGroup> { return group(unwrapOne(await request('UpdateAssetGroup', options, { Id: id, ...(input.name !== undefined ? { Name: input.name } : {}), ...(input.description !== undefined ? { Description: input.description } : {}), ProjectName: project(options) }))); }
export async function updateAsset(options: AssetLibraryRequestOptions, id: string, input: { name: string }): Promise<VolcengineAsset> { return asset(unwrapOne(await request('UpdateAsset', options, { Id: id, Name: input.name, ProjectName: project(options) }))); }
export async function deleteAsset(options: AssetLibraryRequestOptions, id: string): Promise<void> { await request('DeleteAsset', options, { Id: id, ProjectName: project(options) }); }
export async function deleteAssetGroup(options: AssetLibraryRequestOptions, id: string): Promise<void> { await request('DeleteAssetGroup', options, { Id: id, ProjectName: project(options) }); }
export async function createAsset(options: AssetLibraryRequestOptions, input: { assetType: 'Image' | 'Video' | 'Audio'; groupId: string; name: string; url: string }): Promise<{ id: string }> { const result = unwrapOne<Record<string, unknown>>(await request('CreateAsset', options, { AssetType: input.assetType, GroupId: input.groupId, Name: input.name, ProjectName: project(options), URL: input.url })); return { id: String(result.Id ?? result.id ?? '') }; }
