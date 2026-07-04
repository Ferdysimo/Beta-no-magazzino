import React, { useEffect, useState } from 'react';

const CHECK_MS = 60000;
const BUNDLE_VERSION = process.env.REACT_APP_BUILD_VERSION || '';

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
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const [deployedVersion, setDeployedVersion] = useState('');

  useEffect(() => {
    let cancelled = false;
    let intervalId;

    const reloadOnce = (version) => {
      const key = `pastasciutta_reload_${BUNDLE_VERSION || 'unknown'}_to_${version}`;
      const lastAttempt = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - lastAttempt < 10000) {
        setNewVersionAvailable(true);
        return;
      }
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
    };

    const checkVersion = async () => {
      const version = await fetchVersion();
      if (cancelled || !version) return;
      setDeployedVersion(version);
      if (BUNDLE_VERSION && version !== BUNDLE_VERSION) {
        reloadOnce(version);
      }
    };

    checkVersion();
    intervalId = setInterval(checkVersion, CHECK_MS);

    const onFocus = () => checkVersion();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkVersion();
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!newVersionAvailable) return null;

  return (
    <div
      data-testid="update-banner"
      className="fixed top-2 left-1/2 -translate-x-1/2 z-[200] bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 text-sm"
    >
      <span>Aggiornamento disponibile {deployedVersion ? `(${deployedVersion})` : ''}</span>
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
