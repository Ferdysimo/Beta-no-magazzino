import React, { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';

/**
 * Mostra un prompt password prima di rivelare i children.
 * Una volta sbloccato, salva il flag in sessionStorage (dura fino a chiusura tab/browser).
 *
 * Props:
 *   password    – stringa attesa
 *   storageKey  – chiave sessionStorage per memorizzare lo stato sbloccato
 *   title       – titolo del prompt
 *   subtitle    – sottotitolo opzionale
 *   children    – contenuto da mostrare dopo lo sblocco
 */
const PasswordGate = ({ password, storageKey, title = 'Accesso protetto', subtitle, children }) => {
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(storageKey) === '1'; }
    catch (e) { return false; }
  });
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!unlocked && inputRef.current) inputRef.current.focus();
  }, [unlocked]);

  if (unlocked) return children;

  const submit = (e) => {
    e.preventDefault();
    if ((value || '').trim() === String(password)) {
      try { sessionStorage.setItem(storageKey, '1'); } catch (err) {}
      setUnlocked(true);
    } else {
      setError(true);
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5] p-4">
      <form
        onSubmit={submit}
        data-testid="password-gate-form"
        className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 w-full max-w-sm"
      >
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-[#F5C518]/15 flex items-center justify-center mb-3">
            <Lock size={24} className="text-[#F5C518]" />
          </div>
          <h2 className="font-heading text-xl font-bold text-gray-900 uppercase tracking-wide">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
        </div>

        <label htmlFor="pwd" className="block text-xs font-bold text-gray-700 uppercase mb-1">Password</label>
        <input
          id="pwd"
          ref={inputRef}
          data-testid="password-gate-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
          placeholder="••••"
          className={`w-full h-12 px-4 text-center text-2xl font-bold tracking-widest border-2 rounded-lg focus:outline-none ${
            error ? 'border-rose-400 bg-rose-50' : 'border-gray-300 focus:border-[#F5C518]'
          }`}
        />
        {error && (
          <div className="text-rose-600 text-xs font-semibold mt-2 text-center">
            Password errata. Riprova.
          </div>
        )}

        <button
          type="submit"
          data-testid="password-gate-submit"
          className="w-full mt-4 bg-[#F5C518] hover:bg-[#E5A500] text-gray-900 font-bold py-3 rounded-lg shadow"
        >
          SBLOCCA
        </button>
      </form>
    </div>
  );
};

export default PasswordGate;
