import { useEffect, useRef } from 'react';

/**
 * Memorizza la posizione di scroll della pagina (o di un contenitore interno
 * con `overflow:auto`) tra una navigazione e l'altra. Lo stato è salvato in
 * sessionStorage (quindi si perde alla chiusura della tab, NON al refresh).
 *
 *   useScrollMemory('storico-ddt-magazzino', storicoRef);
 *   useScrollMemory('richieste-locale'); // window scroll
 *
 * Comportamento:
 *  - Al mount restituisce lo scrollTop salvato all'ultima visita di questa key.
 *  - Salva continuamente (throttled ~120ms) durante lo scroll.
 *  - Salva anche su `beforeunload` come safety net.
 *  - Se il contenuto della pagina non è ancora caricato al mount (lista vuota),
 *    riprova ad applicare lo scroll per i successivi 1.5s, controllando ogni
 *    100ms se il contenuto è diventato sufficientemente alto.
 */
const useScrollMemory = (key, scrollableRef = null) => {
  const tickRef = useRef(null);

  // Restore on mount + retry while data is loading
  useEffect(() => {
    const storageKey = `scroll_memory_${key}`;
    const saved = parseInt(sessionStorage.getItem(storageKey) || '0', 10);
    if (!saved) return;

    let attempts = 0;
    const tryApply = () => {
      attempts += 1;
      const el = scrollableRef?.current ?? document.scrollingElement ?? document.documentElement;
      if (!el) return false;
      const maxScroll = (el.scrollHeight || 0) - (el.clientHeight || el.innerHeight || 0);
      if (maxScroll >= saved - 4) {
        if (scrollableRef?.current) {
          scrollableRef.current.scrollTop = saved;
        } else {
          window.scrollTo({ top: saved, left: 0, behavior: 'instant' });
        }
        return true;
      }
      return false;
    };

    if (!tryApply()) {
      const id = setInterval(() => {
        if (tryApply() || attempts > 15) clearInterval(id);
      }, 100);
      return () => clearInterval(id);
    }
  }, [key, scrollableRef]);

  // Listen + persist (throttled)
  useEffect(() => {
    const storageKey = `scroll_memory_${key}`;
    const target = scrollableRef?.current ?? window;
    const persist = () => {
      const top = scrollableRef?.current
        ? scrollableRef.current.scrollTop
        : (window.scrollY || window.pageYOffset || 0);
      sessionStorage.setItem(storageKey, String(Math.round(top)));
    };
    const onScroll = () => {
      if (tickRef.current) return;
      tickRef.current = setTimeout(() => {
        tickRef.current = null;
        persist();
      }, 120);
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('beforeunload', persist);
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeunload', persist);
      // Persist one last time on unmount (route change)
      persist();
      if (tickRef.current) { clearTimeout(tickRef.current); tickRef.current = null; }
    };
  }, [key, scrollableRef]);
};

export default useScrollMemory;
