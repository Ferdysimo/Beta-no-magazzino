import { useState, useEffect, useRef } from 'react';

/**
 * useState che persiste in sessionStorage sotto la chiave data.
 * Il valore sopravvive a una navigazione SPA (back/forward, link interni)
 * ma viene perso alla chiusura della tab — esattamente come `useScrollMemory`.
 *
 * Uso:
 *   const [page, setPage] = useSessionState('fatture-page', 1);
 */
const useSessionState = (key, initial) => {
  const storageKey = `session_state_${key}`;
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw == null) return initial;
      return JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const lastWritten = useRef(value);
  useEffect(() => {
    if (lastWritten.current === value) return;
    lastWritten.current = value;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch { /* quota / private mode */ }
  }, [storageKey, value]);
  return [value, setValue];
};

export default useSessionState;
