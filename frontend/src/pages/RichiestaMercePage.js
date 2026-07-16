import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import NavLinkSpa from '../components/NavLinkSpa';
import { formatItalianDateTime } from '../utils/formatDate';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const RichiestaMercePage = () => {
  const { token, restaurant, effectiveRestaurant, canImpersonate } = useAuth();
  const navigate = useNavigate();
  const [richieste, setRichieste] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorModal, setErrorModal] = useState(null); // {id, ddt_number}
  const [errorReason, setErrorReason] = useState('');
  const [submittingError, setSubmittingError] = useState(false);

  const headers = () => {
    const h = { Authorization: `Bearer ${token}` };
    if (canImpersonate && effectiveRestaurant?.id) {
      h['X-Admin-Restaurant-Id'] = effectiveRestaurant.id;
    }
    return h;
  };

  const fetchRichieste = async () => {
    try {
      const res = await axios.get(`${API}/richieste`, { headers: headers() });
      setRichieste(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRichieste();
    const iv = setInterval(fetchRichieste, 8000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showLocation = effectiveRestaurant?.location || restaurant?.location;
  const daEvadere = richieste.filter(r => r.status === 'pending' || r.status === 'evasa');
  const evase = richieste.filter(r => r.status === 'confermata' || r.status === 'errore');

  const handleConferma = async (id) => {
    if (!window.confirm('Confermi di aver ricevuto la merce?')) return;
    try {
      await axios.patch(`${API}/richieste/${id}/conferma`, {}, { headers: headers() });
      fetchRichieste();
    } catch (e) {
      alert(e.response?.data?.detail || 'Errore conferma');
    }
  };

  const openErrorModal = (r) => {
    setErrorModal({ id: r.id, ddt_number: r.ddt_number });
    setErrorReason('');
  };

  const submitError = async () => {
    if (!errorReason.trim()) {
      alert('Spiega il motivo dell\'errore');
      return;
    }
    setSubmittingError(true);
    try {
      await axios.patch(
        `${API}/richieste/${errorModal.id}/errore`,
        { reason: errorReason.trim() },
        { headers: headers() }
      );
      setErrorModal(null);
      setErrorReason('');
      fetchRichieste();
    } catch (e) {
      alert(e.response?.data?.detail || 'Errore segnalazione');
    } finally {
      setSubmittingError(false);
    }
  };

  const handleCancel = async (id) => {
    if (!window.confirm('Vuoi cancellare questa richiesta?')) return;
    try {
      await axios.delete(`${API}/richieste/${id}`, { headers: headers() });
      fetchRichieste();
    } catch (e) {
      alert(e.response?.data?.detail || 'Errore cancellazione');
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-4xl mx-auto p-4 sm:p-6">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 mb-6 uppercase tracking-wide">
          Richiesta / check merce {showLocation}
        </h1>

        {/* CTA Nuova richiesta */}
        <button
          data-testid="btn-nuova-richiesta"
          onClick={() => navigate('/richiesta-merce/nuova')}
          className="w-full mb-8 py-5 px-6 bg-gradient-to-r from-[#F5C518] to-[#F5A518] hover:from-[#F5A518] hover:to-[#E59500] text-gray-900 text-lg font-bold rounded-lg shadow-md transition-all"
        >
          + Nuova richiesta merce
        </button>

        {/* Elenco richieste da evadere */}
        <section className="mb-10">
          <h2 className="text-lg font-bold text-gray-800 mb-3">Elenco richieste da evadere</h2>
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {loading ? (
              <div className="p-4 text-gray-400 text-center">Caricamento...</div>
            ) : daEvadere.length === 0 ? (
              <div className="p-4 text-gray-400 text-center text-sm">Nessuna richiesta aperta.</div>
            ) : daEvadere.map(r => (
              <div key={r.id} data-testid={`richiesta-open-${r.ddt_number}`} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <NavLinkSpa
                  to={`/ddt/${r.id}`}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded border border-gray-300 text-sm font-semibold whitespace-nowrap no-underline"
                  title="Click → apri · Ctrl/⌘+click → nuova scheda"
                >
                  VEDI DDT {r.ddt_number}
                </NavLinkSpa>
                <div className="flex-1 text-sm text-gray-700">
                  <div>Richiesta del <strong>{formatItalianDateTime(r.created_at)}</strong></div>
                  {r.status === 'evasa' && r.evasa_at && (
                    <div className="text-green-700">Evasa il <strong>{formatItalianDateTime(r.evasa_at)}</strong></div>
                  )}
                </div>
                <div className="flex gap-2">
                  {r.status === 'evasa' && (
                    <>
                      <button
                        data-testid={`btn-conferma-${r.ddt_number}`}
                        onClick={() => handleConferma(r.id)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-semibold"
                      >
                        Conferma ricezione
                      </button>
                      <button
                        data-testid={`btn-errore-${r.ddt_number}`}
                        onClick={() => openErrorModal(r)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-semibold"
                      >
                        Errore
                      </button>
                    </>
                  )}
                  {r.status === 'pending' && (
                    <button
                      onClick={() => handleCancel(r.id)}
                      className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded text-sm font-medium"
                    >
                      Cancella
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Elenco richieste evase / confermate */}
        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-3">Elenco richieste evase</h2>
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {evase.length === 0 ? (
              <div className="p-4 text-gray-400 text-center text-sm">Nessuna richiesta evasa.</div>
            ) : evase.map(r => {
              const isError = r.status === 'errore';
              return (
                <div
                  key={r.id}
                  data-testid={`richiesta-closed-${r.ddt_number}`}
                  className={`p-3 sm:p-4 flex flex-col sm:flex-row sm:items-start gap-3 ${isError ? 'bg-red-50' : ''}`}
                >
                  <NavLinkSpa
                    to={`/ddt/${r.id}`}
                    className={`px-4 py-2 rounded border text-sm font-semibold whitespace-nowrap self-start no-underline ${isError ? 'bg-red-100 hover:bg-red-200 border-red-300 text-red-800' : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-800'}`}
                    title="Click → apri · Ctrl/⌘+click → nuova scheda"
                  >
                    VEDI DDT {r.ddt_number}
                  </NavLinkSpa>
                  <div className={`flex-1 text-sm space-y-0.5 ${isError ? 'text-red-800' : 'text-gray-700'}`}>
                    <div>Richiesta del <strong>{formatItalianDateTime(r.created_at)}</strong></div>
                    {r.evasa_at && <div>Evasa il <strong>{formatItalianDateTime(r.evasa_at)}</strong></div>}
                    {r.confermata_at && <div>Confermata il <strong>{formatItalianDateTime(r.confermata_at)}</strong></div>}
                    {isError && (
                      <>
                        <div className="font-bold">⚠ Segnalata come errata il <strong>{formatItalianDateTime(r.error_reported_at)}</strong></div>
                        {r.error_reason && <div className="italic">Motivo: "{r.error_reason}"</div>}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Error reason modal */}
      {errorModal && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={() => !submittingError && setErrorModal(null)}>
          <div className="bg-white rounded-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xl font-bold">!</div>
              <div>
                <div className="font-bold text-gray-900">Segnala un errore</div>
                <div className="text-xs text-gray-500">DDT n° {errorModal.ddt_number}</div>
              </div>
            </div>
            <label className="block text-sm text-gray-700 mb-1">Motivo dell'errore</label>
            <textarea
              data-testid="error-reason-input"
              rows={4}
              value={errorReason}
              onChange={e => setErrorReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
              autoFocus
            />
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => setErrorModal(null)}
                disabled={submittingError}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                data-testid="btn-submit-errore"
                onClick={submitError}
                disabled={submittingError || !errorReason.trim()}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold rounded-lg"
              >
                {submittingError ? 'Invio...' : 'Segnala errore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RichiestaMercePage;
