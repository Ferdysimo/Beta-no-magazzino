import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import PasswordGate from '../components/PasswordGate';
import ClosureDetail from '../components/ClosureDetail';
import { ArrowLeft } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ReportIeriPageInner = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API}/closures/yesterday`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        setDetail(res.data);
      } catch (e) {
        if (!cancelled) setError('Impossibile caricare il report di ieri.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const hasClosure = detail && detail.cash && Object.keys(detail.cash).length > 0;

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-6xl mx-auto p-3 sm:p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <button
            data-testid="back-home"
            onClick={() => navigate('/home')}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 text-sm"
          >
            <ArrowLeft size={16} /> Home
          </button>
          <span className="text-[11px] text-gray-500">Chiusura del giorno precedente</span>
        </div>

        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 uppercase mb-4">
          Report di ieri
        </h1>

        <section className="bg-white border border-gray-200 rounded-lg p-4">
          {loading ? (
            <div className="text-center text-gray-400 py-10">Caricamento…</div>
          ) : error ? (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded p-3 text-sm">{error}</div>
          ) : !hasClosure ? (
            <div className="text-center text-gray-500 py-10">
              <div className="text-sm">Nessuna chiusura disponibile per ieri.</div>
              <div className="text-[11px] text-gray-400 mt-1">
                Il report di ieri compare automaticamente dopo lo scatto di mezzanotte.
              </div>
            </div>
          ) : (
            <ClosureDetail detail={detail} />
          )}
        </section>
      </main>
    </div>
  );
};

const ReportIeriPage = () => (
  <PasswordGate
    password="0123"
    storageKey="flaminio-section-unlocked"
    title="Report di ieri"
    subtitle="Inserisci la password per accedere"
  >
    <ReportIeriPageInner />
  </PasswordGate>
);

export default ReportIeriPage;
