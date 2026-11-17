import { z, type ZodType } from 'zod';
import { clearToken, getToken } from './auth';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** True for an `ApiError` with HTTP 404 (a missing file, directory or record). */
export const isNotFound = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 404;

async function call(
  method: string,
  url: string,
  body?: unknown,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getToken() ?? ''}`,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      window.location.reload();
    }
    const { error } = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new ApiError(
      error?.code ?? 'UNKNOWN',
      error?.message ?? res.statusText,
      res.status,
    );
  }
  return res;
}

/** GET a text body (e.g. an HTML report) with the same auth and error handling. */
export async function requestText(url: string): Promise<string> {
  return (await call('GET', url)).text();
}

/** Response of a call whose body is deliberately not used (the UI learns the result from WS events or a refetch). */
export const IGNORED: ZodType<unknown> = z.unknown();

/**
 * JSON request. With a `schema` the response is validated at runtime (a mismatch throws a
 * `ZodError`, shown by the query's error state). Without one the call must not return data:
 * use `request<void>(method, url, body?)` for 204 mutations.
 */
export function request<T>(
  method: string,
  url: string,
  body: unknown,
  schema: ZodType<T>,
): Promise<T>;
export function request<T extends void>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T>;
export async function request(
  method: string,
  url: string,
  body?: unknown,
  schema?: ZodType<unknown>,
): Promise<unknown> {
  const text = await (await call(method, url, body)).text();
  if (!schema) return undefined;
  return schema.parse(text ? JSON.parse(text) : undefined);
}
