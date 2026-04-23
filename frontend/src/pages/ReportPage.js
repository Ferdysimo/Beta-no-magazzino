import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const todayRomeIso = () => {
  // Europe/Rome current date as YYYY-MM-DD (avoids UTC midnight skew in nighttime)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  return parts;
};

const ReportPage = () => {
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

  const formatTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

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

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      
      <main className="max-w-6xl mx-auto p-6">
        {/* Page Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="font-heading text-4xl font-bold text-gray-900 italic">Lista ordini</h1>
          </div>
          <p className="font-heading text-2xl text-gray-500 italic" data-testid="report-location">
            {restaurant?.location}
          </p>
        </div>

        {/* Date Selector */}
        <div className="flex items-center gap-4 mb-6">
          <select
            data-testid="date-selector"
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
            data-testid="visualizza-btn"
            onClick={fetchReport}
            disabled={loading}
            className="action-button h-10 px-6"
          >
            {loading ? 'Caricamento...' : 'Visualizza'}
          </button>
        </div>

        {/* Report Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-700 w-1/2">Ordine</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 w-24">Inv.</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 w-24">Compl.</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 w-24">Canc.</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 w-24">Mod.</th>
              </tr>
            </thead>
            <tbody>
              {report?.items?.map((item, index) => (
                <tr 
                  key={index}
                  data-testid={`report-row-${item.order_number}`}
                  className={`border-b border-gray-100 hover:bg-gray-50 ${
                    item.status === 'deleted' ? 'bg-red-50' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <span className="font-medium">
                      {item.order_number} {item.description}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatTime(item.created_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatTime(item.completed_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatTime(item.deleted_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatTime(item.modified_at)}
                  </td>
                </tr>
              ))}
              
              {(!report?.items || report.items.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    Nessun ordine per questa data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Summary Stats */}
        {report && (
          <div className="mt-4 flex gap-6 text-sm text-gray-600">
            <span>Totale: <strong>{report.total_orders}</strong></span>
            <span>Completati: <strong className="text-green-600">{report.completed}</strong></span>
            <span>Cancellati: <strong className="text-red-600">{report.deleted}</strong></span>
            <span>In attesa: <strong className="text-amber-600">{report.pending}</strong></span>
          </div>
        )}
      </main>
    </div>
  );
};

export default ReportPage;
