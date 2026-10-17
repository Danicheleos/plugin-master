const KEY = 'pm-token';

export const getToken = (): string | null => localStorage.getItem(KEY);
export const clearToken = (): void => localStorage.removeItem(KEY);

/** Moves `?token=` from the URL into localStorage and strips it from the address bar. */
export function captureToken(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) return;
  localStorage.setItem(KEY, token);
  url.searchParams.delete('token');
  window.history.replaceState(null, '', url);
}
