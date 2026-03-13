import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { Receipt, Timer, List, FileText, FileSpreadsheet, Banknote, X, FileCheck } from 'lucide-react';

const HomePage = () => {
  const { restaurant } = useAuth();
  const navigate = useNavigate();

  const mainButtons = [
    {
      id: 'cassa',
      label: 'Cassa',
      icon: Receipt,
      path: '/cassa',
      description: 'Gestione ordini',
      primary: true
    },
    {
      id: 'tablet-bollitore',
      label: 'Tablet bollitore',
      icon: Timer,
      path: '/bollitore',
      description: 'ordini scritti normalmente',
      primary: true
    },
    {
      id: 'tablet-generale',
      label: 'Tablet generale',
      icon: List,
      path: '/generale',
      description: 'tutti gli ordini',
      primary: true
    }
  ];

  const secondaryButtons = [
    { id: 'report-cassa', label: 'Report di cassa', icon: FileText },
    { id: 'report-excel', label: 'Report per Excel', icon: FileSpreadsheet },
    { id: 'versamenti', label: 'Versamenti', icon: Banknote },
    { id: 'chiusure', label: 'Chiusure', icon: X },
    { id: 'fatture', label: 'Fatture', icon: FileCheck },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      
      <main className="max-w-5xl mx-auto p-6">
        {/* Main Content Card */}
        <div className="bg-[#ECECEC] border border-gray-300 rounded-lg p-8">
          {/* Logo */}
          <div className="flex items-start mb-8">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <svg width="60" height="60" viewBox="0 0 100 100">
                  <circle cx="50" cy="30" r="8" fill="#F5C518" />
                  <path d="M42 35 Q50 70 58 35" stroke="#F5C518" strokeWidth="4" fill="none" />
                  <path d="M38 35 Q50 75 62 35" stroke="#F5C518" strokeWidth="3" fill="none" />
                  <path d="M35 35 Q50 80 65 35" stroke="#F5C518" strokeWidth="2" fill="none" />
                  <line x1="50" y1="25" x2="80" y2="15" stroke="#333" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </div>
              <h1 className="font-heading text-4xl font-bold tracking-tight text-gray-800 uppercase">
                — Pastasciutta —
              </h1>
              <p className="font-heading text-lg tracking-[0.3em] text-gray-600 uppercase">
                Roma
              </p>
              <p className="font-heading text-xl font-semibold text-gray-800 mt-4" data-testid="restaurant-location">
                {restaurant?.location}
              </p>
            </div>
          </div>

          {/* Main Navigation Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Left Column - Cassa and Secondary */}
            <div className="space-y-4">
              <button
                data-testid="btn-cassa"
                onClick={() => navigate('/cassa')}
                className="action-button w-auto px-8"
              >
                Cassa
              </button>
              
              <div className="flex flex-wrap gap-2">
                <button
                  data-testid="btn-report-cassa"
                  onClick={() => navigate('/report')}
                  className="bg-[#3B82F6] hover:bg-[#2563EB] text-white px-4 py-2 rounded-md font-medium text-sm transition-colors"
                >
                  Report di cassa
                </button>
                {secondaryButtons.slice(1, 2).map((btn) => (
                  <button
                    key={btn.id}
                    data-testid={`btn-${btn.id}`}
                    className="bg-[#3B82F6] hover:bg-[#2563EB] text-white px-4 py-2 rounded-md font-medium text-sm transition-colors"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              
              <div className="flex flex-wrap gap-2">
                {secondaryButtons.slice(2).map((btn) => (
                  <button
                    key={btn.id}
                    data-testid={`btn-${btn.id}`}
                    className="bg-[#60A5FA] hover:bg-[#3B82F6] text-white px-4 py-2 rounded-md font-medium text-sm transition-colors"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Right Column - Tablet buttons */}
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <button
                  data-testid="btn-tablet-bollitore"
                  onClick={() => navigate('/bollitore')}
                  className="action-button"
                >
                  Tablet bollitore
                </button>
                <span className="text-gray-600 text-sm">ordini scritti normalmente</span>
              </div>
              
              <div className="flex items-center gap-4">
                <button
                  data-testid="btn-tablet-generale"
                  onClick={() => navigate('/generale')}
                  className="action-button"
                >
                  Tablet generale
                </button>
                <span className="text-gray-600 text-sm">tutti gli ordini</span>
              </div>
            </div>
          </div>

          {/* Bottom Section */}
          <div className="border-t border-gray-300 pt-6">
            <button
              data-testid="btn-magazzino"
              className="border border-gray-400 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-md font-medium text-sm transition-colors"
            >
              Richiesta / Check merce dal magazzino
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default HomePage;
