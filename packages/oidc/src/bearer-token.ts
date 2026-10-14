/**
 * The token of an `Authorization: Bearer` header; `null` for any other scheme, or none. One rule
 * for the gateway and the NestJS guard, so that both take the same header for a token. A header
 * sent twice counts with its first value.
 */
export function bearerToken(authorization: string | string[] | undefined): string | null {
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  return /^Bearer\s+(\S+)$/i.exec(value ?? '')?.[1] ?? null;
}
