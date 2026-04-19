import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { formatItalianDateTime } from '../utils/formatDate';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const MagazzinoRichiestePage = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    try {
      const [p, h] = await Promise.all([
        axios.get(`${API}/richieste/pending-all`, { headers }),
        axios.get(`${API}/richieste/history-all`, { headers }),
      ]);
      setPending(p.data || []);
      setHistory(h.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 8000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEvade = async (r) => {
    if (!window.confirm(`Confermi l'evasione del DDT ${r.ddt_number}? Le quantità verranno scalate dal magazzino.`)) return;
    try {
      await axios.patch(`${API}/richieste/${r.id}/evade`, {}, { headers });
      fetchData();
    } catch (e) {
      alert(e.response?.data?.detail || 'Errore evasione');
    }
  };

  const daEvadere = pending.filter(p => p.status === 'pending');
  const evase = pending.filter(p => p.status === 'evasa'); // aspettano conferma locale

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase tracking-wide">
            Richieste in arrivo
          </h1>
          <button
            onClick={() => navigate('/magazzino')}
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            ← Torna al magazzino
          </button>
        </div>

        {/* Da evadere */}
        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-800 mb-3">
            Da evadere <span className="text-sm text-gray-500 font-normal">({daEvadere.length})</span>
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y">
            {loading ? (
              <div className="p-4 text-gray-400 text-center">Caricamento...</div>
            ) : daEvadere.length === 0 ? (
              <div className="p-4 text-gray-400 text-center text-sm">Nessuna richiesta da evadere.</div>
            ) : daEvadere.map(r => (
              <div key={r.id} data-testid={`mag-ddt-${r.ddt_number}`} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <button
                  onClick={() => navigate(`/ddt/${r.id}`)}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded border border-gray-300 text-sm font-semibold whitespace-nowrap"
                >
                  VEDI DDT {r.ddt_number}
                </button>
                <div className="flex-1 text-sm text-gray-700">
                  <div className="font-semibold text-gray-900">{r.restaurant_location}</div>
                  <div className="text-xs text-gray-500">{(r.items || []).length} articoli · {formatItalianDateTime(r.created_at)}</div>
                </div>
                <button
                  data-testid={`btn-evadi-${r.ddt_number}`}
                  onClick={() => handleEvade(r)}
                  className="bg-[#F5C518] hover:bg-[#E5B418] text-gray-900 px-5 py-2.5 rounded font-bold shadow-sm"
                >
                  Evadi
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Evase in attesa di conferma */}
        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-800 mb-3">
            Evase, in attesa di conferma <span className="text-sm text-gray-500 font-normal">({evase.length})</span>
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y">
            {evase.length === 0 ? (
              <div className="p-4 text-gray-400 text-center text-sm">Nessuna richiesta in attesa.</div>
            ) : evase.map(r => (
              <div key={r.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <button
                  onClick={() => navigate(`/ddt/${r.id}`)}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded border border-gray-300 text-sm font-semibold whitespace-nowrap"
                >
                  VEDI DDT {r.ddt_number}
                </button>
                <div className="flex-1 text-sm text-gray-700">
                  <div className="font-semibold text-gray-900">{r.restaurant_location}</div>
                  <div className="text-xs text-gray-500">Evasa il {formatItalianDateTime(r.evasa_at)}</div>
                </div>
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
                  In attesa conferma locale
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Storico */}
        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-3">
            Storico confermate <span className="text-sm text-gray-500 font-normal">({history.length})</span>
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y max-h-96 overflow-y-auto">
            {history.length === 0 ? (
              <div className="p-4 text-gray-400 text-center text-sm">Nessuna richiesta nello storico.</div>
            ) : history.map(r => (
              <div key={r.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                <button
                  onClick={() => navigate(`/ddt/${r.id}`)}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1.5 rounded border border-gray-300 text-xs font-semibold whitespace-nowrap"
                >
                  DDT {r.ddt_number}
                </button>
                <div className="flex-1">
                  <span className="font-semibold">{r.restaurant_location}</span>
                  <span className="text-gray-500"> · Confermata il {formatItalianDateTime(r.confermata_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default MagazzinoRichiestePage;
