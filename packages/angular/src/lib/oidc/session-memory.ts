/**
 * What the library keeps across the login, which leaves the page and comes back: in the session
 * storage of the tab, where there is one. Without it -- blocked storage -- nothing is kept, and
 * nothing fails.
 */
export const sessionMemory = {
  get(key: string): string | null {
    try {
      return globalThis.sessionStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.sessionStorage?.setItem(key, value);
    } catch {
      // Nothing to keep it in
    }
  },
  remove(key: string): void {
    try {
      globalThis.sessionStorage?.removeItem(key);
    } catch {
      // Nothing to forget
    }
  }
};
