import type { ZodType } from 'zod';
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

export async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  schema?: ZodType<T>,
): Promise<T> {
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
  const text = await res.text();
  if (!text) return undefined as T;
  const data: unknown = JSON.parse(text);
  return schema ? schema.parse(data) : (data as T);
}
