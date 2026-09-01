import { DEMO_DISPLAY_NAME } from '../presentation/actors';
import type { AttributionPrincipal } from '../presentation/attribution';

/**
 * Signed anonymous demo session. The Worker verifies or mints one cookie per
 * request; the resulting principal addresses the registry shard and stamps
 * attribution. Session material never leaves this module except as the typed
 * principal (actor id, display name, internal workspace key).
 */

export const DEMO_COOKIE_NAME = 'comake_demo_v1';
export const DEMO_COOKIE_VERSION = 1;
export const DEMO_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface DemoPrincipal extends AttributionPrincipal {
  /** Internal registry shard key; never exposed to the client. */
  workspaceKey: string;
}

export interface DemoSessionResolution {
  minted: boolean;
  principal: DemoPrincipal;
  setCookie: string | null;
}

interface SessionPayload {
  exp: number;
  sid: string;
  v: number;
}

export function isSecretConfigured(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.length > 0;
}

export function readNamedCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (cookieHeader === undefined || cookieHeader.length === 0) {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (trimmed.slice(0, separator) === name) {
      return trimmed.slice(separator + 1);
    }
  }
  return undefined;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function bytesToBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let binary = '';
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function encodePayload(payload: SessionPayload): Uint8Array {
  return encoder.encode(JSON.stringify({ exp: payload.exp, sid: payload.sid, v: payload.v }));
}

/** Web Crypto in Workers types BufferSource as ArrayBuffer-backed views only. */
function cryptoSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function hmacSign(key: CryptoKey, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> {
  const source = data instanceof ArrayBuffer ? data : cryptoSource(data);
  return crypto.subtle.sign('HMAC', key, source);
}

async function hmacVerify(key: CryptoKey, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  try {
    return await crypto.subtle.verify('HMAC', key, cryptoSource(signature), cryptoSource(data));
  } catch {
    return false;
  }
}

async function derivePrincipal(key: CryptoKey, sessionId: string): Promise<DemoPrincipal> {
  const [actorMac, workspaceMac] = await Promise.all([
    hmacSign(key, encoder.encode(`actor-v1:${sessionId}`)),
    hmacSign(key, encoder.encode(`workspace-v1:${sessionId}`)),
  ]);
  return {
    actorId: `demo:${bytesToBase64Url(actorMac)}`,
    displayName: DEMO_DISPLAY_NAME,
    workspaceKey: `comake:demo:v1:${bytesToBase64Url(workspaceMac)}`,
  };
}

function formatSetCookie(cookieValue: string, requestUrl: URL): string {
  const parts = [
    `${DEMO_COOKIE_NAME}=${cookieValue}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${DEMO_SESSION_TTL_SECONDS}`,
  ];
  if (requestUrl.protocol === 'https:') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export async function signDemoSessionPayload(
  secret: string,
  payload: SessionPayload,
): Promise<string> {
  const key = await importHmacKey(secret);
  const payloadBytes = encodePayload(payload);
  const mac = await hmacSign(key, payloadBytes);
  return `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(mac)}`;
}

export async function verifyDemoSessionCookieValue(
  secret: string,
  cookieValue: string,
  nowMs = Date.now(),
): Promise<DemoPrincipal | null> {
  const key = await importHmacKey(secret);
  return verifyCookieWithKey(key, cookieValue, nowMs);
}

async function verifyCookieWithKey(
  key: CryptoKey,
  cookieValue: string,
  nowMs: number,
): Promise<DemoPrincipal | null> {
  const separator = cookieValue.indexOf('.');
  if (separator <= 0 || cookieValue.indexOf('.', separator + 1) !== -1) {
    return null;
  }
  const payloadBytes = base64UrlToBytes(cookieValue.slice(0, separator));
  const macBytes = base64UrlToBytes(cookieValue.slice(separator + 1));
  if (!payloadBytes || !macBytes) {
    return null;
  }
  const verified = await hmacVerify(key, macBytes, payloadBytes);
  if (!verified) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !('v' in parsed) ||
    !('sid' in parsed) ||
    !('exp' in parsed)
  ) {
    return null;
  }
  const payload = parsed as { exp: unknown; sid: unknown; v: unknown };
  if (payload.v !== DEMO_COOKIE_VERSION) {
    return null;
  }
  if (typeof payload.sid !== 'string' || !SESSION_ID_PATTERN.test(payload.sid)) {
    return null;
  }
  if (typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp)) {
    return null;
  }
  if (payload.exp <= Math.floor(nowMs / 1000)) {
    return null;
  }
  return derivePrincipal(key, payload.sid);
}

export async function mintDemoSessionCookie(
  secret: string,
  nowMs = Date.now(),
  requestUrl: URL = new URL('http://localhost/'),
): Promise<{ cookieValue: string; principal: DemoPrincipal; setCookie: string }> {
  const key = await importHmacKey(secret);
  return mintWithKey(key, nowMs, requestUrl);
}

async function mintWithKey(
  key: CryptoKey,
  nowMs: number,
  requestUrl: URL,
): Promise<{ cookieValue: string; principal: DemoPrincipal; setCookie: string }> {
  const sessionId = crypto.randomUUID();
  const expiresAtUnix = Math.floor(nowMs / 1000) + DEMO_SESSION_TTL_SECONDS;
  const payloadBytes = encodePayload({ v: DEMO_COOKIE_VERSION, sid: sessionId, exp: expiresAtUnix });
  const mac = await hmacSign(key, payloadBytes);
  const cookieValue = `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(mac)}`;
  const principal = await derivePrincipal(key, sessionId);
  return {
    cookieValue,
    principal,
    setCookie: formatSetCookie(cookieValue, requestUrl),
  };
}

/**
 * Verify the request cookie or mint a fresh isolated session. Invalid,
 * expired, unsupported-version, or malformed cookies never grant the old
 * workspace — they mint a new principal.
 */
export async function resolveDemoSession(request: Request, secret: string): Promise<DemoSessionResolution> {
  const key = await importHmacKey(secret);
  const raw = readNamedCookie(request.headers.get('Cookie') ?? undefined, DEMO_COOKIE_NAME);
  if (raw !== undefined) {
    const principal = await verifyCookieWithKey(key, raw, Date.now());
    if (principal) {
      return { minted: false, principal, setCookie: null };
    }
  }
  const minted = await mintWithKey(key, Date.now(), new URL(request.url));
  return { minted: true, principal: minted.principal, setCookie: minted.setCookie };
}

function isProtectedContent(response: Response): boolean {
  const contentType = response.headers.get('Content-Type') ?? '';
  return contentType.includes('text/html') || contentType.includes('application/json');
}

/**
 * Append Set-Cookie when a session was minted and disable shared caching on
 * HTML/JSON without buffering the body.
 */
export function applyDemoSessionResponse(
  response: Response,
  session: DemoSessionResolution,
): Response {
  const protect = session.minted || isProtectedContent(response);
  if (!session.setCookie && !protect) {
    return response;
  }
  const headers = new Headers(response.headers);
  if (session.setCookie) {
    headers.append('Set-Cookie', session.setCookie);
  }
  if (protect) {
    headers.set('Cache-Control', 'private, no-store');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
