import React from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';

const MagazzinierePage = () => {
  const navigate = useNavigate();

  const mainButtons = [
    { label: 'Richieste in arrivo', path: '/magazzino/richieste-in-arrivo' },
    { label: 'Modifica prodotti magazzino', path: '/magazzino/prodotti' },
    { label: 'Carico verso il magazzino', path: '/magazzino/carichi' },
    { label: 'Scarico verso i locali', path: null },
  ];

  const secondaryButtons = [
    { label: 'Inventario / Forza il sistema', path: null },
    { label: 'Per analisi', path: null },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-4xl mx-auto p-6">
        <div className="mb-8">
          <h1 className="font-heading text-4xl font-bold text-gray-900 uppercase tracking-wide">
            Magazziniere
          </h1>
        </div>

        <div className="flex flex-col gap-4 max-w-md">
          {mainButtons.map((btn) => (
            <button
              key={btn.label}
              data-testid={`mag-btn-${btn.label.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => btn.path && navigate(btn.path)}
              className={`w-full py-4 px-6 text-white text-lg font-semibold rounded-lg transition-all text-left ${
                btn.path
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 cursor-pointer'
                  : 'bg-gradient-to-r from-blue-400 to-blue-300 opacity-60 cursor-not-allowed'
              }`}
              disabled={!btn.path}
            >
              {btn.label}
            </button>
          ))}

          <div className="h-2" />

          {secondaryButtons.map((btn) => (
            <button
              key={btn.label}
              data-testid={`mag-btn-${btn.label.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => btn.path && navigate(btn.path)}
              className={`w-full py-4 px-6 text-white text-lg font-semibold rounded-lg transition-all text-left ${
                btn.path
                  ? 'bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-600 hover:to-teal-500 cursor-pointer'
                  : 'bg-gradient-to-r from-teal-400 to-teal-300 opacity-60 cursor-not-allowed'
              }`}
              disabled={!btn.path}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
};

export default MagazzinierePage;
