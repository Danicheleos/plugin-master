import { storage } from '../shared/storage';

const KEY = 'pm-token';

export const getToken = (): string | null => storage.get(KEY);
export const clearToken = (): void => storage.remove(KEY);

/** Moves `?token=` from the URL into localStorage and strips it from the address bar. */
export function captureToken(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) return;
  storage.set(KEY, token);
  url.searchParams.delete('token');
  window.history.replaceState(null, '', url);
}
