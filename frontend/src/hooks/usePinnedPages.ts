import { useCallback, useEffect, useState } from 'react';

const PINNED_KEY = 'dd-hc:pinned-pages';
const RECENT_KEY = 'dd-hc:recent-pages';
const RECENT_LIMIT = 6;

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — ignore */
  }
}

export function usePinnedPages() {
  const [pinned, setPinned] = useState<string[]>(() => readList(PINNED_KEY));

  useEffect(() => writeList(PINNED_KEY, pinned), [pinned]);

  const isPinned = useCallback((path: string) => pinned.includes(path), [pinned]);

  const togglePin = useCallback((path: string) => {
    setPinned((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  }, []);

  const reorderPinned = useCallback((next: string[]) => setPinned(next), []);

  return { pinned, isPinned, togglePin, reorderPinned };
}

export function useRecentPages() {
  const [recent, setRecent] = useState<string[]>(() => readList(RECENT_KEY));

  useEffect(() => writeList(RECENT_KEY, recent), [recent]);

  const trackVisit = useCallback((path: string) => {
    setRecent((prev) => [path, ...prev.filter((p) => p !== path)].slice(0, RECENT_LIMIT));
  }, []);

  return { recent, trackVisit };
}
