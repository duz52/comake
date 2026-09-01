/**
 * Same-origin mutation gate. State-changing requests must present an Origin
 * that exactly matches the request URL origin. Missing, opaque (`null`), or
 * cross-origin values fail closed. Safe methods are not gated here.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isStateChangingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/** True when the request Origin header is this URL's origin. */
export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin === null || origin === '' || origin === 'null') {
    return false;
  }
  return origin === new URL(request.url).origin;
}
