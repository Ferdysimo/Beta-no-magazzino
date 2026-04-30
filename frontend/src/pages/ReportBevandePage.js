import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ReportBevandePage = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/beverages/report`, {
        params: { date_from: dateFrom, date_to: dateTo },
        headers: { Authorization: `Bearer ${token}` }
      });
      setReport(res.data);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Errore caricamento report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-4xl mx-auto p-4 sm:p-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-gray-700 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={18} /> Indietro
        </button>

        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase mb-6">
          Report Bevande
        </h1>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Dal</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                data-testid="bev-rep-from"
                className="w-full px-3 py-2 border border-gray-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Al</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                data-testid="bev-rep-to"
                className="w-full px-3 py-2 border border-gray-300 rounded"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={fetchReport}
                data-testid="bev-rep-apply"
                className="flex-1 bg-[#F5C518] hover:bg-[#E5A500] text-gray-900 font-bold py-2 rounded-lg"
              >
                Applica
              </button>
              <button
                onClick={() => { setDateFrom(today); setDateTo(today); setTimeout(fetchReport, 10); }}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Oggi
              </button>
            </div>
          </div>
        </div>

        {/* Report table */}
        {loading ? (
          <div className="text-center text-gray-400 py-10">Caricamento...</div>
        ) : report ? (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Sigla</th>
                  <th className="text-left px-3 py-2 font-semibold">Bevanda</th>
                  <th className="text-right px-3 py-2 font-semibold">Q.tà</th>
                  <th className="text-right px-3 py-2 font-semibold hidden sm:table-cell">Prezzo</th>
                  <th className="text-right px-3 py-2 font-semibold">Totale</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map(i => (
                  <tr key={i.sigla} data-testid={`rep-row-${i.sigla}`} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-bold">{i.sigla}</td>
                    <td className="px-3 py-2 text-gray-800">{i.name}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${i.count === 0 ? 'text-gray-400' : 'text-gray-900'}`}>{i.count}</td>
                    <td className="px-3 py-2 text-right text-gray-600 hidden sm:table-cell">€ {i.price.toFixed(2)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${i.total === 0 ? 'text-gray-400' : 'text-green-700'}`}>€ {i.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td className="px-3 py-3 font-bold text-gray-800" colSpan={2}>Totale</td>
                  <td className="px-3 py-3 text-right font-bold text-gray-900" data-testid="bev-rep-total-count">{report.total_count}</td>
                  <td className="hidden sm:table-cell" />
                  <td className="px-3 py-3 text-right font-extrabold text-lg text-green-700" data-testid="bev-rep-grand-total">€ {report.grand_total.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </main>
    </div>
  );
};

export default ReportBevandePage;
