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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3 sm:mb-6 px-1">
          <h1 className="font-heading text-xl sm:text-3xl font-bold text-gray-800">
            Numeri - report totali di giornata
          </h1>
          <button
            type="button"
            onClick={downloadExcel}
            disabled={downloadingExcel}
            className="bg-[#F5C518] hover:bg-[#e0b315] disabled:bg-gray-300 disabled:cursor-not-allowed text-gray-900 font-bold px-4 py-2 rounded shadow-sm border border-yellow-500 text-sm"
          >
            {downloadingExcel ? 'SCARICO...' : 'SCARICA EXCEL'}
          </button>
        </div>

        {(() => {
          const displayName = (loc) => (loc === 'Largo di Brazzà' ? 'Brazzà' : loc);
          const averagesCeil = Object.fromEntries(
            data.locations.map(loc => [loc, Math.ceil(data.averages[loc] || 0)])
          );
          const totalAverage = data.locations.reduce((sum, loc) => sum + averagesCeil[loc], 0);

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
                        {averagesCeil[loc].toLocaleString('it-IT')}
                      </td>
                    ))}
                    <td className="px-0.5 sm:px-4 py-2 sm:py-3 font-bold text-gray-800 text-[10px] sm:text-base text-center sm:text-left tabular-nums whitespace-nowrap">
                      {totalAverage.toLocaleString('it-IT')}
                    </td>
                  </tr>

                  {/* Daily rows */}
                  {data.days.map((day, idx) => {
                    const dailyTotal = data.locations.reduce(
                      (sum, loc) => sum + (Number(day.locations[loc]) || 0),
                      0
                    );
                    return (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="pl-1.5 pr-0.5 sm:px-4 py-1.5 sm:py-2 text-gray-700 text-[10px] sm:text-sm tabular-nums whitespace-nowrap">{day.date}</td>
                        {data.locations.map(loc => (
                          <td key={loc} className="px-0.5 sm:px-4 py-1.5 sm:py-2 text-gray-800 text-[10px] sm:text-sm text-center sm:text-left tabular-nums whitespace-nowrap">
                            {day.locations[loc] || ''}
                          </td>
                        ))}
                        <td className="px-0.5 sm:px-4 py-1.5 sm:py-2 font-semibold text-gray-800 text-[10px] sm:text-sm text-center sm:text-left tabular-nums whitespace-nowrap">
                          {dailyTotal > 0 ? dailyTotal.toLocaleString('it-IT') : ''}
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
