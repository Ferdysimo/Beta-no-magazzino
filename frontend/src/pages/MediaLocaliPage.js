import React, { useEffect, useState } from 'react';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const MediaLocaliPage = () => {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [viewMode, setViewMode] = useState('numbers');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get(`${API}/admin/media-locali`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setData(res.data);
      } catch (error) {
        console.error('Error fetching media locali:', error);
      }
      setLoading(false);
    };
    fetchData();
  }, [token]);

  const downloadExcel = async () => {
    const year = new Date().getFullYear();
    setDownloadingExcel(true);
    try {
      const res = await axios.get(`${API}/admin/media-locali/export?year=${year}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });

      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `numeri_locali_${year}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Error downloading media locali excel:', error);
      window.alert('Errore nello scaricare il file Excel');
    } finally {
      setDownloadingExcel(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <p className="text-gray-600">Caricamento...</p>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <p className="text-red-600">Errore nel caricamento dei dati</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-3xl mx-auto p-2 sm:p-6">
        <div className="mb-3 sm:mb-6 px-1 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="font-heading text-xl sm:text-3xl font-bold text-gray-800">
                {viewMode === 'numbers'
                  ? 'Numeri - report totali di giornata'
                  : 'Fatturato - vendita piatti e bevande'}
              </h1>
              {viewMode === 'revenue' && (
                <p className="text-xs sm:text-sm text-gray-500 mt-1">Valori espressi in euro</p>
              )}
            </div>
            {viewMode === 'numbers' && (
              <button
                type="button"
                onClick={downloadExcel}
                disabled={downloadingExcel}
                className="bg-[#F5C518] hover:bg-[#e0b315] disabled:bg-gray-300 disabled:cursor-not-allowed text-gray-900 font-bold px-4 py-2 rounded shadow-sm border border-yellow-500 text-sm"
              >
                {downloadingExcel ? 'SCARICO...' : 'SCARICA EXCEL'}
              </button>
            )}
          </div>

          <div
            className="inline-flex w-full sm:w-auto rounded-lg border border-gray-300 bg-gray-100 p-1"
            role="group"
            aria-label="Modalità visualizzazione"
          >
            <button
              type="button"
              data-testid="media-mode-numbers"
              aria-pressed={viewMode === 'numbers'}
              onClick={() => setViewMode('numbers')}
              className={`flex-1 sm:flex-none px-5 py-2 rounded-md text-sm font-bold transition-colors ${
                viewMode === 'numbers'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Numeri
            </button>
            <button
              type="button"
              data-testid="media-mode-revenue"
              aria-pressed={viewMode === 'revenue'}
              onClick={() => setViewMode('revenue')}
              className={`flex-1 sm:flex-none px-5 py-2 rounded-md text-sm font-bold transition-colors ${
                viewMode === 'revenue'
                  ? 'bg-[#F5C518] text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Fatturato
            </button>
          </div>
        </div>

        {(() => {
          const isRevenue = viewMode === 'revenue';
          const displayName = (loc) => (loc === 'Largo di Brazzà' ? 'Brazzà' : loc);
          const displayedAverages = Object.fromEntries(
            data.locations.map(loc => [
              loc,
              isRevenue
                ? Number(data.revenue_averages?.[loc] || 0)
                : Math.ceil(data.averages[loc] || 0),
            ])
          );
          const totalAverage = data.locations.reduce(
            (sum, loc) => sum + displayedAverages[loc],
            0
          );
          const formatValue = (value) => Number(value).toLocaleString('it-IT', {
            minimumFractionDigits: isRevenue ? 2 : 0,
            maximumFractionDigits: isRevenue ? 2 : 0,
          });

          return (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <table className="w-full table-fixed" data-testid="media-locali-table">
                <colgroup>
                  <col className="w-[23%] sm:w-auto" />
                  {data.locations.map(loc => <col key={loc} />)}
                  <col className="w-[15%] sm:w-auto" />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-300">
                    <th className="text-left pl-1.5 pr-0.5 sm:px-4 py-2 sm:py-3 font-semibold text-gray-700 text-[10px] sm:text-sm whitespace-nowrap">Giorno</th>
                    {data.locations.map(loc => (
                      <th
                        key={loc}
                        title={loc}
                        className="px-0.5 sm:px-4 py-2 sm:py-3 font-semibold text-gray-700 text-[9px] sm:text-sm text-center sm:text-left leading-tight break-words"
                      >
                        {displayName(loc)}
                      </th>
                    ))}
                    <th className="px-0.5 sm:px-4 py-2 sm:py-3 font-semibold text-gray-700 text-[9px] sm:text-sm text-center sm:text-left whitespace-nowrap">
                      <span className="sm:hidden">Tot.</span>
                      <span className="hidden sm:inline">Totale</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Media row */}
                  <tr className="border-b-2 border-gray-400 bg-gray-50">
                    <td className="pl-1.5 pr-0.5 sm:px-4 py-2 sm:py-3 font-bold text-gray-800 text-[10px] sm:text-base whitespace-nowrap">Media</td>
                    {data.locations.map(loc => (
                      <td key={loc} className="px-0.5 sm:px-4 py-2 sm:py-3 font-bold text-gray-800 text-[10px] sm:text-base text-center sm:text-left tabular-nums whitespace-nowrap">
                        {formatValue(displayedAverages[loc])}
                      </td>
                    ))}
                    <td className="px-0.5 sm:px-4 py-2 sm:py-3 font-bold text-gray-800 text-[10px] sm:text-base text-center sm:text-left tabular-nums whitespace-nowrap">
                      {formatValue(totalAverage)}
                    </td>
                  </tr>

                  {/* Daily rows */}
                  {data.days.map((day, idx) => {
                    const dayValues = isRevenue ? (day.revenues || {}) : day.locations;
                    const dailyTotal = data.locations.reduce(
                      (sum, loc) => sum + (Number(dayValues[loc]) || 0),
                      0
                    );
                    return (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="pl-1.5 pr-0.5 sm:px-4 py-1.5 sm:py-2 text-gray-700 text-[10px] sm:text-sm tabular-nums whitespace-nowrap">{day.date}</td>
                        {data.locations.map(loc => (
                          <td key={loc} className="px-0.5 sm:px-4 py-1.5 sm:py-2 text-gray-800 text-[10px] sm:text-sm text-center sm:text-left tabular-nums whitespace-nowrap">
                            {dayValues[loc] === null || dayValues[loc] === undefined
                              ? ''
                              : formatValue(dayValues[loc])}
                          </td>
                        ))}
                        <td className="px-0.5 sm:px-4 py-1.5 sm:py-2 font-semibold text-gray-800 text-[10px] sm:text-sm text-center sm:text-left tabular-nums whitespace-nowrap">
                          {dailyTotal > 0 ? formatValue(dailyTotal) : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </main>
    </div>
  );
};

export default MediaLocaliPage;
