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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-5xl mx-auto p-6">
          <p className="text-gray-600">Caricamento...</p>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-5xl mx-auto p-6">
          <p className="text-red-600">Errore nel caricamento dei dati</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-5xl mx-auto p-6">
        <h1 className="font-heading text-3xl font-bold text-gray-800 mb-6">
          Numeri - report totali di giornata
        </h1>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left px-4 py-3 font-semibold text-gray-700 text-sm">Giorno</th>
                {data.locations.map(loc => (
                  <th key={loc} className="text-left px-4 py-3 font-semibold text-gray-700 text-sm">{loc}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Media row */}
              <tr className="border-b-2 border-gray-400 bg-gray-50">
                <td className="px-4 py-3 font-bold text-gray-800">Media</td>
                {data.locations.map(loc => (
                  <td key={loc} className="px-4 py-3 font-bold text-gray-800">
                    {data.averages[loc]?.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0'}
                  </td>
                ))}
              </tr>

              {/* Daily rows */}
              {data.days.map((day, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-700 text-sm">{day.date}</td>
                  {data.locations.map(loc => (
                    <td key={loc} className="px-4 py-2 text-gray-800 text-sm">
                      {day.locations[loc] || ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};

export default MediaLocaliPage;
