// Browser storage that never throws. It can be refused outright (blocked cookies and
// site data, private modes), full, or unreachable: the app must still start. What
// cannot be saved is kept in memory for the rest of the session, and reads come back
// from there, so the app keeps working until the page is closed.
function createSafeStorage(area: () => Storage) {
  const memory = new Map<string, string>();
  const inMemory = new Set<string>();
  let failed = false;

  return {
    getItem(key: string): string | null {
      if (inMemory.has(key)) return memory.get(key) ?? null;
      try {
        return area().getItem(key);
      } catch {
        failed = true;
        return null;
      }
    },

    // Returns whether the value was really saved
    setItem(key: string, value: string): boolean {
      try {
        area().setItem(key, value);
        memory.delete(key);
        inMemory.delete(key);
        return true;
      } catch {
        failed = true;
        memory.set(key, value);
        inMemory.add(key);
        return false;
      }
    },

    removeItem(key: string): void {
      memory.delete(key);
      try {
        area().removeItem(key);
        inMemory.delete(key);
      } catch {
        failed = true;
        // The stored value could not be removed: it must not come back on a read
        inMemory.add(key);
      }
    },

    // Whether something could not be read or saved so far
    hasFailed(): boolean {
      return failed;
    },

    // Whether the storage can be written now
    probe(): boolean {
      try {
        const storage = area();
        storage.setItem('wealthtrack_probe', '1');
        storage.removeItem('wealthtrack_probe');
        return true;
      } catch {
        failed = true;
        return false;
      }
    },

    reset(): void {
      memory.clear();
      inMemory.clear();
      failed = false;
    },
  };
}

export const safeLocal = createSafeStorage(() => globalThis.localStorage);
export const safeSession = createSafeStorage(() => globalThis.sessionStorage);

// For tests
export function resetSafeStorage(): void {
  safeLocal.reset();
  safeSession.reset();
}
