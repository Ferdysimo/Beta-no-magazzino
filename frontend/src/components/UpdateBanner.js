import React, { useEffect, useState } from 'react';

// Checks once at app mount + once a day at 03:00 local time (restaurant closed).
// If the deployed version changed, shows a banner asking the cashier to reload
// when convenient — no forced reload.

const CHECK_HOUR = 3; // 03:00 local

const msUntilNextCheck = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(CHECK_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
};

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

const UpdateBanner = () => {
  const [initialVersion, setInitialVersion] = useState(null);
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId;

    const scheduleNext = () => {
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        const v = await fetchVersion();
        if (!cancelled && v && initialVersion && v !== initialVersion) {
          setNewVersionAvailable(true);
        }
        if (!cancelled) scheduleNext();
      }, msUntilNextCheck());
    };

    (async () => {
      // Initial fetch at mount (so on first open the reference version is set)
      const v = await fetchVersion();
      if (cancelled) return;
      if (v) setInitialVersion(v);
      scheduleNext();
    })();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
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
