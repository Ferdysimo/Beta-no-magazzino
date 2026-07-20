import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FlaskConical, ScanLine } from 'lucide-react';
import Header from '../components/Header';

const LaboratorioPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />

      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-5 sm:py-7">
        <div className="flex items-start justify-between gap-4 mb-7">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 flex items-center justify-center bg-[#F5C518] border border-yellow-600 rounded-md shrink-0">
              <FlaskConical size={23} className="text-gray-950" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-950 uppercase">
                Laboratorio
              </h1>
              <p className="text-sm text-gray-600 mt-1">Spazio prove Simone</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/home')}
            className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-2 rounded-md font-semibold text-sm shrink-0"
          >
            <ArrowLeft size={17} aria-hidden="true" />
            <span className="hidden sm:inline">Indietro</span>
          </button>
        </div>

        <div className="border-y border-gray-300 py-4 mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-heading text-lg font-bold text-gray-900 uppercase">Esperimenti</h2>
            <p className="text-sm text-gray-500 mt-0.5">1 disponibile</p>
          </div>
          <span className="inline-flex items-center h-7 px-2.5 bg-white border border-gray-300 rounded text-xs font-bold text-gray-700 uppercase">
            Isolato
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <button
            type="button"
            data-testid="lab-open-document-scanner"
            onClick={() => navigate('/laboratorio/scanner-documenti')}
            className="group min-h-[156px] text-left bg-white border border-gray-300 hover:border-yellow-500 rounded-md p-5 transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-500"
          >
            <div className="h-full flex flex-col">
              <div className="flex items-start justify-between gap-4">
                <div className="h-10 w-10 flex items-center justify-center bg-gray-100 border border-gray-200 rounded-md">
                  <ScanLine size={21} className="text-gray-800" aria-hidden="true" />
                </div>
                <span className="text-[11px] font-bold uppercase text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                  Acquisizione pronta
                </span>
              </div>

              <div className="mt-5 flex items-end justify-between gap-4">
                <div>
                  <h3 className="font-heading text-lg font-bold text-gray-950">Scanner documenti</h3>
                  <p className="text-sm text-gray-500 mt-1">Fatture e DDT</p>
                </div>
                <ChevronRight
                  size={21}
                  className="text-gray-400 group-hover:text-gray-900 transition-colors shrink-0"
                  aria-hidden="true"
                />
              </div>
            </div>
          </button>
        </div>
      </main>
    </div>
  );
};

export default LaboratorioPage;
