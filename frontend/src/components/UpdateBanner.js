import React, { useEffect, useState } from 'react';

// Polls /version.json every ~60s; if the version changes after app mount,
// shows a friendly banner prompting the user to reload. This removes the
// need for cashiers to hard-reload manually after each deploy.

const POLL_MS = 60_000;

const UpdateBanner = () => {
  const [initialVersion, setInitialVersion] = useState(null);
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchVersion = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const data = await res.json();
        return data.version || null;
      } catch {
        return null;
      }
    };

    const init = async () => {
      const v = await fetchVersion();
      if (!cancelled && v) setInitialVersion(v);
    };

    const check = async () => {
      if (cancelled || !initialVersion) return;
      const v = await fetchVersion();
      if (!cancelled && v && v !== initialVersion) {
        setNewVersionAvailable(true);
      }
    };

    init();
    const id = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [initialVersion]);

  if (!newVersionAvailable) return null;

  return (
    <div
      data-testid="update-banner"
      className="fixed top-2 left-1/2 -translate-x-1/2 z-[200] bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 text-sm"
    >
      <span>È disponibile un aggiornamento</span>
      <button
        onClick={() => window.location.reload()}
        data-testid="update-reload-btn"
        className="bg-white text-emerald-700 font-bold px-3 py-1 rounded-md hover:bg-emerald-50"
      >
        Ricarica
      </button>
    </div>
  );
};

export default UpdateBanner;
