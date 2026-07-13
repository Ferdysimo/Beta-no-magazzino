import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Download } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const downloadErrorMessage = async (error) => {
  try {
    let payload = error?.response?.data;
    if (payload instanceof Blob) {
      payload = JSON.parse(await payload.text());
    }
    const detail = payload?.detail;
    if (detail && typeof detail === 'object') {
      const firstIssue = detail.issues?.[0];
      const firstCase = firstIssue
        ? ` Primo caso: ${firstIssue.location}, ${firstIssue.date} (${firstIssue.actual_count}/${firstIssue.expected_count}).`
        : '';
      return `${detail.message || "Dati non coerenti per l'export."}${firstCase}`;
    }
    if (typeof detail === 'string' && detail) return detail;
  } catch (parseError) {
    console.error('analisi mensile errore non leggibile', parseError);
  }
  return 'Errore nello scaricare il file Excel';
};

const AnalisiAnnualePage = () => {
  const navigate = useNavigate();
  const { token, restaurant } = useAuth();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const yearOptions = useMemo(() => {
    const out = [];
    for (let y = currentYear; y >= currentYear - 5; y -= 1) out.push(y);
    return out;
  }, [currentYear]);

  const downloadExcel = async () => {
    if (!token) return;
    setDownloading(true);
    setError('');
    setNotice('');
    try {
      const res = await axios.get(`${API}/admin/analisi-mensile/export?year=${year}`, {
        headers,
        responseType: 'blob',
      });
      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `analisi_mensile_${year}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      const warningCount = Number(res.headers?.['x-analysis-warning-count'] || 0);
      const missingSnapshots = Number(res.headers?.['x-analysis-missing-snapshot-count'] || 0);
      if (warningCount > 0) {
        const snapshotText = missingSnapshots > 0
          ? ` ${missingSnapshots} giornate usano il dizionario paste attuale perché prive di snapshot storico.`
          : '';
        setNotice(`Excel scaricato con ${warningCount} avvisi storici.${snapshotText}`);
      }
    } catch (e) {
      console.error('analisi mensile export', e);
      setError(await downloadErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900"
          >
            <ArrowLeft size={16} /> Home
          </button>
          <div className="text-sm font-bold text-gray-700">
            {restaurant?.username || 'Admin'}
          </div>
        </div>

        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase mb-5">
          Analisi mensile
        </h1>

        <div className="bg-white border-y border-gray-300 px-4 py-5 sm:px-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-gray-700" htmlFor="analysis-year">
              Anno
            </label>
            <select
              id="analysis-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border border-gray-300 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#F5C518]"
            >
              {yearOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={downloadExcel}
            disabled={downloading}
            className="flex items-center justify-center gap-2 bg-[#F5C518] hover:bg-[#e0b315] disabled:bg-gray-300 disabled:cursor-not-allowed text-gray-900 font-black px-5 py-2.5 rounded border border-yellow-500 text-sm"
          >
            <Download size={17} />
            {downloading ? 'Scarico...' : 'Scarica Excel'}
          </button>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-800 rounded px-4 py-3 text-sm font-bold">
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-4 bg-yellow-50 border border-yellow-300 text-yellow-900 rounded px-4 py-3 text-sm font-bold">
            {notice}
          </div>
        )}
      </main>
    </div>
  );
};

export default AnalisiAnnualePage;
