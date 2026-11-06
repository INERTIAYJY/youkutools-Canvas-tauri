/**
 * ai/providers/volcengineSigner — 火山引擎方舟 AK/SK Signature V4 签名器
 *
 * 方舟素材资产库（Assets）API 仅支持 Access Key（AK/SK）鉴权，
 * 服务端校验的是标准的「火山引擎 V4 签名」（HMAC-SHA256 派生）。
 *
 * 签名流程（对应火山引擎开放平台通用 OpenAPI 签名规范）：
 *  1. CanonicalRequest = Method + "\n" + CanonicalURI + "\n" + CanonicalQueryString
 *                        + "\n" + CanonicalHeaders + "\n" + SignedHeaders
 *                        + "\n" + HexSHA256(Payload)
 *  2. StringToSign     = "HMAC-SHA256" + "\n" + XDate + "\n" + CredentialScope
 *                        + "\n" + HexSHA256(CanonicalRequest)
 *  3. SigningKey       = HMAC(Service, HMAC(Region, HMAC(Date, HMAC("volcengine", SK))))
 *  4. Signature        = HexHMAC(SigningKey, StringToSign)
 *  5. Authorization    = HMAC-SHA256 Credential=<AK>/<scope>, SignedHeaders=..., Signature=...
 *
 * 仅依赖 Web Crypto（HMAC-SHA256），无需引入第三方库。
 */

const SIGNING_ALGORITHM = 'HMAC-SHA256';
const SIGNING_SERVICE = 'ark';
const SIGNING_REQUEST = 'request';

interface SignerInput {
  method: string;
  url: string;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 区域，默认 cn-beijing。 */
  region?: string;
  /** 额外需要签入 CanonicalHeaders 的自定义头（值已确定）。 */
  extraHeaders?: Record<string, string>;
}

interface SignedHeaders {
  headers: Record<string, string>;
}

/** 将字符串编码为 UTF-8 字节。 */
function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** 计算 SHA-256 十六进制摘要。 */
async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? utf8(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** 计算 HMAC-SHA256，返回原始字节。 */
async function hmac(key: Uint8Array | string, data: string | Uint8Array): Promise<Uint8Array> {
  const keyBytes = typeof key === 'string' ? utf8(key) : key;
  const dataBytes = typeof data === 'string' ? utf8(data) : data;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes as BufferSource);
  return new Uint8Array(signature);
}

/** 十六进制 HMAC-SHA256（火山引擎签名各派生步骤均用此形式）。 */
async function hmacHex(key: Uint8Array | string, data: string | Uint8Array): Promise<string> {
  const bytes = await hmac(key, data);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** 生成 ISO8601 格式时间（UTC，精确到秒）：20240101T000000Z。 */
function formatXDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 按字典序对 query 参数排序并编码（火山引擎 CanonicalQueryString 规则）。 */
function canonicalQueryString(searchParams: URLSearchParams): string {
  const entries: Array<[string, string]> = [];
  searchParams.forEach((value, key) => entries.push([key, value]));
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/**
 * 生成火山引擎 V4 签名请求头。
 *
 * 返回应合并进请求的 headers（包含 Authorization / X-Date 及已签入的 Content-Type）。
 */
export async function signVolcengineRequest(input: SignerInput): Promise<SignedHeaders> {
  const { method, url, body, accessKeyId, secretAccessKey, region = 'cn-beijing', extraHeaders = {} } = input;

  const parsed = new URL(url);
  const date = new Date();
  const xDate = formatXDate(date);
  // 火山引擎日期分区：YYYYMMDD
  const shortDate = xDate.slice(0, 8);

  // Content-Type 参与签名，必须与请求体实际类型一致。
  const contentType = 'application/json';

  // 参与签名的 header（小写、按字典序）。火山引擎强制签入 Host 与 X-Date；
  // 与火山引擎官方 SDK 一致：请求体摘要既作为 CanonicalRequest 的最后一行，
  // 也以 X-Content-Sha256 请求头发送并参与签名。
  const payloadHash = await sha256Hex(body);
  const host = parsed.host;

  const headersToSign: Record<string, string> = {
    'content-type': contentType,
    host,
    'x-content-sha256': payloadHash,
    'x-date': xDate,
    ...Object.fromEntries(
      Object.entries(extraHeaders).map(([key, value]) => [key.toLowerCase(), value]),
    ),
  };

  const signedHeaderNames = Object.keys(headersToSign).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headersToSign[name].trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalQuery = canonicalQueryString(parsed.searchParams);
  const canonicalURI = parsed.pathname || '/';

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalURI,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${shortDate}/${region}/${SIGNING_SERVICE}/${SIGNING_REQUEST}`;
  const stringToSign = [
    SIGNING_ALGORITHM,
    xDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  // 与官方 SDK signingKeyV4 一致：日期、区域、服务、request 依次派生。
  const kDate = await hmac(secretAccessKey, shortDate);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, SIGNING_SERVICE);
  const kSigning = await hmac(kService, SIGNING_REQUEST);
  const signature = await hmacHex(kSigning, stringToSign);

  const authorization =
    `${SIGNING_ALGORITHM} Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      'Content-Type': contentType,
      'X-Date': xDate,
      'X-Content-Sha256': payloadHash,
      Authorization: authorization,
      ...extraHeaders,
    },
  };
}
