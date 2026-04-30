import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import SystemAlertsBanner from '../components/SystemAlertsBanner';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const HomePage = () => {
  const { restaurant, token, isAdmin, effectiveRestaurant, selectRestaurant, clearSelectedRestaurant } = useAuth();
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState([]);

  // Magazziniere goes straight to magazzino
  useEffect(() => {
    if (restaurant?.role === 'magazzino') {
      navigate('/magazzino', { replace: true });
    }
  }, [restaurant, navigate]);

  // Admin: fetch restaurant list
  useEffect(() => {
    if (isAdmin && token) {
      axios.get(`${API}/admin/restaurants`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(res => setRestaurants(res.data)).catch(console.error);
    }
  }, [isAdmin, token]);

  // Admin without selected restaurant: show selector
  if (isAdmin && !effectiveRestaurant) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <SystemAlertsBanner />
        <main className="max-w-3xl mx-auto p-6">
          <div className="bg-[#ECECEC] border border-gray-300 rounded-lg p-8">
            <div className="flex items-center gap-4 mb-6">
              <img src="/logo-icon.png" alt="Pastasciutta Roma" className="h-16 object-contain" />
              <div>
                <h1 className="font-heading text-3xl font-bold text-gray-800 uppercase">Amministratore</h1>
                <p className="text-gray-600">Seleziona un locale</p>
              </div>
            </div>
            <div className="space-y-3">
              {restaurants.map(r => (
                <button
                  key={r.id}
                  data-testid={`admin-select-${r.location}`}
                  onClick={() => selectRestaurant(r)}
                  className="w-full text-left px-6 py-4 bg-white hover:bg-yellow-50 border border-gray-300 hover:border-[#F5C518] rounded-lg transition-colors"
                >
                  <span className="font-bold text-lg text-gray-800">{r.location}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 pt-6 border-t border-gray-300 space-y-3">
              <button
                data-testid="admin-magazzino"
                onClick={() => navigate('/magazzino')}
                className="w-full text-left px-6 py-4 bg-white hover:bg-yellow-50 border border-gray-300 hover:border-[#F5C518] rounded-lg transition-colors"
              >
                <span className="font-bold text-lg text-gray-800">Magazzino</span>
                <span className="block text-xs text-gray-500 mt-0.5">Accedi alle funzionalità del magazziniere</span>
              </button>
              <button
                data-testid="admin-media-locali"
                onClick={() => navigate('/media-locali')}
                className="w-full text-left px-6 py-4 bg-white hover:bg-yellow-50 border border-gray-300 hover:border-[#F5C518] rounded-lg transition-colors"
              >
                <span className="font-bold text-lg text-gray-800">Media locali</span>
              </button>
              <button
                data-testid="admin-diagnostica"
                onClick={() => navigate('/diagnostica')}
                className="w-full text-left px-6 py-4 bg-white hover:bg-yellow-50 border border-gray-300 hover:border-[#F5C518] rounded-lg transition-colors"
              >
                <span className="font-bold text-lg text-gray-800">Diagnostica live</span>
                <span className="block text-xs text-gray-500 mt-0.5">WebSocket, latenze e errori in tempo reale</span>
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const showLocation = effectiveRestaurant?.location || restaurant?.location;

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <SystemAlertsBanner />
      
      <main className="max-w-5xl mx-auto p-6">
        <div className="bg-[#ECECEC] border border-gray-300 rounded-lg p-8">
          {/* Logo */}
          <div className="flex items-start mb-8">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <img src="/logo-icon.png" alt="Pastasciutta Roma" className="h-16 object-contain" />
              </div>
              <h1 className="font-heading text-4xl font-bold tracking-tight text-gray-800 uppercase">
                — Pastasciutta —
              </h1>
              <p className="font-heading text-lg tracking-[0.3em] text-gray-600 uppercase">
                Roma
              </p>
              <div className="flex items-center gap-3 mt-4">
                <p className="font-heading text-xl font-semibold text-gray-800" data-testid="restaurant-location">
                  {showLocation}
                </p>
                {isAdmin && (
                  <button
                    data-testid="admin-switch-location"
                    onClick={clearSelectedRestaurant}
                    className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded transition-colors"
                  >
                    Cambia locale
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Main Navigation Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="space-y-4">
              <button data-testid="btn-cassa" onClick={() => navigate('/cassa')} className="action-button w-auto px-8">
                Cassa
              </button>
              
              <div className="flex flex-wrap gap-2">
                <button data-testid="btn-report-cassa" onClick={() => navigate('/report')}
                  className="bg-[#3B82F6] hover:bg-[#2563EB] text-white px-4 py-2 rounded-md font-medium text-sm transition-colors">
                  Report di cassa
                </button>
                <button data-testid="btn-report-excel" onClick={() => navigate('/report-excel')}
                  className="bg-[#3B82F6] hover:bg-[#2563EB] text-white px-4 py-2 rounded-md font-medium text-sm transition-colors">
                  Report per Excel
                </button>
              </div>
              
              <div className="flex flex-wrap gap-2">
                <button data-testid="btn-versamenti" onClick={() => navigate('/versamenti')}
                  className="bg-[#60A5FA] hover:bg-[#3B82F6] text-white px-4 py-2 rounded-md font-medium text-sm transition-colors">
                  Versamenti
                </button>
                <button data-testid="btn-chiusure" onClick={() => navigate('/chiusure')}
                  className="bg-[#60A5FA] hover:bg-[#3B82F6] text-white px-4 py-2 rounded-md font-medium text-sm transition-colors">
                  Chiusure
                </button>
                <button data-testid="btn-fatture" onClick={() => navigate('/fatture')}
                  className="bg-[#60A5FA] hover:bg-[#3B82F6] text-white px-4 py-2 rounded-md font-medium text-sm transition-colors">
                  Fatture
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <button data-testid="btn-tablet-bollitore" onClick={() => navigate('/bollitore')} className="action-button">
                  Tablet bollitore
                </button>
                <span className="text-gray-600 text-sm">ordini scritti normalmente</span>
              </div>

              {/* Tablet Bollitore 2 - Flaminio or Admin viewing Flaminio */}
              {(showLocation === 'Flaminio') && (
                <div className="flex items-center gap-4">
                  <button data-testid="btn-tablet-bollitore-2" onClick={() => navigate('/bollitore2')} className="action-button">
                    Tablet bollitore 2
                  </button>
                  <span className="text-gray-600 text-sm">simbolo: -</span>
                </div>
              )}
              
              <div className="flex items-center gap-4">
                <button data-testid="btn-tablet-generale" onClick={() => navigate('/generale')} className="action-button">
                  Tablet generale
                </button>
                <span className="text-gray-600 text-sm">tutti gli ordini</span>
              </div>

              {/* Monitor Clienti - Flaminio or Admin viewing Flaminio */}
              {(showLocation === 'Flaminio') && (
                <div className="flex items-center gap-4">
                  <button data-testid="btn-monitor-clienti" onClick={() => navigate('/monitor-clienti')} className="action-button">
                    Monitor clienti
                  </button>
                  <span className="text-gray-600 text-sm">monitor sala</span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Section */}
          <div className="border-t border-gray-300 pt-6 flex flex-wrap gap-3">
            <button data-testid="btn-magazzino" onClick={() => navigate('/richiesta-merce')}
              className="border border-gray-400 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-md font-medium text-sm transition-colors">
              Richiesta / Check merce dal magazzino
            </button>
            {isAdmin && (
              <button data-testid="btn-media-locali" onClick={() => navigate('/media-locali')}
                className="border border-gray-400 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-md font-medium text-sm transition-colors">
                Media locali
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default HomePage;
