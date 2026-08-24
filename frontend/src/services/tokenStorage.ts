// "Remember me" toggles which storage the token lands in: localStorage
// persists across browser restarts, sessionStorage clears when the tab/window
// closes — the right default for a shared/public machine. Both are checked on
// read and cleared on write/clear so a stale copy in the other storage can
// never win (e.g. switching accounts on the same device with different
// remember-me choices).
const KEY = 'dd_auth_token';

export function getToken(): string | null {
  return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
}

export function setToken(token: string, remember: boolean): void {
  clearToken();
  (remember ? localStorage : sessionStorage).setItem(KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
