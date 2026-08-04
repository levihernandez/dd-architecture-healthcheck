import { useEffect, useRef } from 'react';

type ShortcutHandler = () => void;

interface ShortcutMap {
  [combo: string]: ShortcutHandler;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Registers global keyboard shortcuts. Supports single keys ("?", "/") and
 * two-key chords in sequence ("g o") captured within a short window, in the
 * style of Gmail/Linear/GitHub. Ignored while focus is inside a form field.
 */
export function useKeyboardShortcuts(map: ShortcutMap, enabled = true) {
  const chordRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      const now = Date.now();

      if (map[key]) {
        e.preventDefault();
        map[key]();
        chordRef.current = null;
        return;
      }

      const prev = chordRef.current;
      if (prev && now - prev.at < 600) {
        const combo = `${prev.key} ${key}`;
        if (map[combo]) {
          e.preventDefault();
          map[combo]();
          chordRef.current = null;
          return;
        }
      }
      chordRef.current = { key, at: now };
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [map, enabled]);
}
