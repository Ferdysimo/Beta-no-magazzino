import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { formatItalianDate } from '../utils/formatDate';
import { Printer, ArrowLeft } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const DDTViewPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [ddt, setDdt] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await axios.get(`${API}/richieste/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setDdt(res.data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [id, token]);

  const handlePrint = () => window.print();

  if (loading) return <div className="p-8 text-center text-gray-400">Caricamento DDT...</div>;
  if (!ddt) return <div className="p-8 text-center text-red-600">DDT non trovato</div>;

  const dest = ddt.destinatario || {};
  const mitt = ddt.mittente || {};

  return (
    <div className="min-h-screen bg-gray-200 print:bg-white">
      {/* Toolbar (hidden on print) */}
      <div className="bg-white border-b border-gray-300 px-4 py-3 flex items-center justify-between print:hidden">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-700 hover:text-gray-900 text-sm font-medium"
        >
          <ArrowLeft size={18} /> Indietro
        </button>
        <button
          data-testid="btn-stampa-ddt"
          onClick={handlePrint}
          className="flex items-center gap-2 bg-[#F5C518] hover:bg-[#E5B418] text-gray-900 font-semibold px-5 py-2 rounded-lg shadow-sm"
        >
          <Printer size={18} /> Stampa DDT
        </button>
      </div>

      {/* A4 sheet */}
      <div className="mx-auto my-6 bg-white shadow print:shadow-none print:my-0 print:mx-0 px-12 py-10 max-w-[850px] print:max-w-full" id="ddt-print">
        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div className="flex-1 flex justify-center">
            <div className="text-center">
              <img src="/logo-icon.png" alt="Pastasciutta" className="h-20 mx-auto object-contain mb-2" />
              <div className="font-heading text-3xl font-bold tracking-tight text-gray-900">— Pastasciutta —</div>
              <div className="font-heading text-sm tracking-[0.3em] text-gray-600 uppercase">Roma</div>
            </div>
          </div>
          <div className="border border-gray-400 px-6 py-4 text-sm min-w-[260px]">
            <div className="text-gray-600 uppercase tracking-wide text-xs mb-3">Documento di trasporto</div>
            <div className="text-right">
              N°. <strong className="text-lg">{ddt.ddt_number}</strong> DEL <strong>{formatItalianDate(ddt.created_at)}</strong>
            </div>
          </div>
        </div>

        {/* Mittente / Destinatario */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="border border-gray-400 p-4">
            <div className="text-gray-600 uppercase tracking-wide text-xs mb-2">Mittente</div>
            <div className="font-bold text-gray-900 mb-1">{mitt.name || 'Pastasciutta Srl'}</div>
            <div className="text-gray-700 text-sm">{mitt.address || ''}</div>
            <div className="text-gray-700 text-sm">{mitt.postal_code} {mitt.city}</div>
          </div>
          <div className="border border-gray-400 p-4">
            <div className="text-gray-600 uppercase tracking-wide text-xs mb-2">Destinatario</div>
            <div className="font-bold text-gray-900 mb-1">{dest.name || ddt.restaurant_location || ''}</div>
            <div className="text-gray-700 text-sm">{dest.address || ''}</div>
            <div className="text-gray-700 text-sm">{dest.postal_code} {dest.city}</div>
          </div>
        </div>

        {/* Items table */}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-700 text-white">
              <th className="border border-gray-500 px-3 py-2 text-center font-semibold w-2/3">Descrizione dei beni</th>
              <th className="border border-gray-500 px-3 py-2 text-center font-semibold">Unità di misura</th>
              <th className="border border-gray-500 px-3 py-2 text-center font-semibold">Quantità</th>
            </tr>
          </thead>
          <tbody>
            {(ddt.items || []).map((it, i) => (
              <tr key={i} className="odd:bg-white even:bg-gray-50">
                <td className="border border-gray-300 px-3 py-2">{it.product_name}</td>
                <td className="border border-gray-300 px-3 py-2 text-center">{it.unit || '—'}</td>
                <td className="border border-gray-300 px-3 py-2 text-center font-semibold">{it.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Status footer */}
        <div className="mt-10 text-xs text-gray-500 border-t border-gray-200 pt-3 print:hidden">
          Stato: <strong className={ddt.status === 'errore' ? 'text-red-700' : ''}>{ddt.status}</strong>
          {ddt.evasa_at && <span> · Evasa il {formatItalianDate(ddt.evasa_at)}</span>}
          {ddt.confermata_at && <span> · Confermata il {formatItalianDate(ddt.confermata_at)}</span>}
          {ddt.error_reported_at && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-red-800">
              <div className="font-bold">⚠ Errore segnalato dal locale il {formatItalianDate(ddt.error_reported_at)}</div>
              {ddt.error_reason && <div className="italic mt-1">"{ddt.error_reason}"</div>}
            </div>
          )}
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          @page { size: A4; margin: 10mm; }
          #ddt-print { box-shadow: none !important; padding: 0 !important; margin: 0 !important; }
        }
      `}</style>
    </div>
  );
};

export default DDTViewPage;
