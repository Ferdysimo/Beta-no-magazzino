import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import axios from 'axios';
import { Download } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const todayRomeIso = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const ReportExcelPage = () => {
  const { restaurant, token } = useAuth();
  const [selectedDate, setSelectedDate] = useState(todayRomeIso());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API}/report/daily?date=${selectedDate}T00:00:00`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setReport(response.data);
    } catch (error) {
      console.error('Error fetching report:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [token]);

  const formatDateDisplay = (dateStr) => {
    const date = new Date(dateStr);
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    return date.toLocaleDateString('it-IT', options);
  };

  // Generate date options for dropdown (last 30 days)
  const generateDateOptions = () => {
    const options = [];
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      options.push({
        value: fmt.format(date),
        label: formatDateDisplay(date)
      });
    }
    return options;
  };

  // Filter out deleted items: the Excel export should reflect only orders
  // that actually went out of the kitchen (pending/completed). Deletions are
  // tracked separately in the Report di Cassa.
  const excelItems = (report?.items || []).filter(it => it.status !== 'deleted');

  // Export to CSV (Excel compatible)
  const exportToExcel = () => {
    if (!excelItems.length) return;
    
    // Create CSV content
    let csv = 'Ordine\n';
    excelItems.forEach(item => {
      csv += `${item.order_number} ${item.description}\n`;
    });
    
    // Create blob and download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ordini_${selectedDate}_${restaurant?.location || 'report'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      
      <main className="max-w-4xl mx-auto p-6">
        {/* Page Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="font-heading text-4xl font-bold text-gray-900 italic">Lista ordini</h1>
          </div>
          <p className="font-heading text-2xl text-gray-500 italic" data-testid="report-excel-location">
            {restaurant?.location}
          </p>
        </div>

        {/* Date Selector and Export */}
        <div className="flex items-center gap-4 mb-6">
          <select
            data-testid="excel-date-selector"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-10 px-4 border border-gray-300 rounded bg-white focus:border-blue-500 focus:outline-none"
          >
            {generateDateOptions().map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            data-testid="excel-visualizza-btn"
            onClick={fetchReport}
            disabled={loading}
            className="action-button h-10 px-6"
          >
            {loading ? 'Caricamento...' : 'Visualizza'}
          </button>
          <button
            data-testid="excel-download-btn"
            onClick={exportToExcel}
            disabled={!excelItems.length}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white h-10 px-4 rounded-md font-bold transition-colors disabled:opacity-50"
          >
            <Download size={18} />
            Scarica Excel
          </button>
        </div>

        {/* Simple Table - Only Ordine column */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-semibold text-gray-700">Ordine</th>
              </tr>
            </thead>
            <tbody>
              {excelItems.map((item, index) => (
                <tr 
                  key={index}
                  data-testid={`excel-row-${item.order_number}`}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-6 py-3">
                    <span className="font-medium">
                      {item.order_number} {item.description}
                    </span>
                  </td>
                </tr>
              ))}
              
              {excelItems.length === 0 && (
                <tr>
                  <td className="px-6 py-8 text-center text-gray-500">
                    Nessun ordine per questa data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Total count */}
        {report && (
          <div className="mt-4 text-sm text-gray-600">
            Totale ordini: <strong>{excelItems.length}</strong>
          </div>
        )}
      </main>
    </div>
  );
};

export default ReportExcelPage;
