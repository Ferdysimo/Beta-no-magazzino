import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { formatItalianDate } from '../utils/formatDate';
import { Printer, ArrowLeft, Pencil } from 'lucide-react';
import { sortByCanonicalOrder } from '../utils/productOrder';

// For legacy DDTs (no dispatch_date stored), fall back to created_at + 1 day.
const addOneDay = (iso) => {
  if (!iso) return iso;
  try {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  } catch { return iso; }
};

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const DDTViewPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, restaurant, effectiveRestaurant, canImpersonate, isAdmin } = useAuth();
  const activeRestaurant = canImpersonate ? effectiveRestaurant : restaurant;
  const [ddt, setDdt] = useState(null);
  const [loading, setLoading] = useState(true);
  // Tick di 1s per il countdown "Modificabile per ancora MM:SS"
  const [now, setNow] = useState(() => Date.now());

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

  // Countdown: minuti/secondi rimanenti prima del congelamento (20 min totali).
  // Visibile SOLO al locale proprietario quando la richiesta è ancora pending.
  // L'admin non lo vede (può modificare in qualsiasi momento).
  const editWindow = (() => {
    if (!ddt || ddt.status !== 'pending') return null;
    if (isAdmin) return null;
    const isOwner = ddt.restaurant_id === activeRestaurant?.id;
    if (!isOwner) return null;
    try {
      const created = new Date(ddt.created_at).getTime();
      const deadline = created + 20 * 60 * 1000;
      const remainingMs = deadline - now;
      if (remainingMs <= 0) return { expired: true };
      return {
        expired: false,
        ms: remainingMs,
        mm: Math.floor(remainingMs / 60000),
        ss: Math.floor((remainingMs % 60000) / 1000),
        critical: remainingMs <= 5 * 60 * 1000,
      };
    } catch {
      return null;
    }
  })();

  // Refresh ogni secondo SOLO finché c'è una finestra di modifica attiva.
  useEffect(() => {
    if (!editWindow || editWindow.expired) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [editWindow]);

  // Editable rules: status pending + (admin OR (owner AND within 20min))
  const canEdit = (() => {
    if (!ddt || ddt.status !== 'pending') return false;
    if (isAdmin) return true;
    const isOwner = ddt.restaurant_id === activeRestaurant?.id;
    if (!isOwner) return false;
    try {
      const ageMs = Date.now() - new Date(ddt.created_at).getTime();
      return ageMs >= 0 && ageMs < 20 * 60 * 1000;
    } catch {
      return false;
    }
  })();

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
        <div className="flex items-center gap-2">
          {ddt.updated_at && ddt.updated_at !== ddt.created_at && (() => {
            const mins = Math.max(0, Math.floor((Date.now() - new Date(ddt.updated_at).getTime()) / 60000));
            if (mins > 1440) return null;
            return (
              <span
                data-testid="ddt-modified-badge"
                title={`Ultima modifica: ${ddt.updated_at}`}
                className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-900 border border-yellow-300 rounded-full px-2.5 py-1 text-xs font-semibold"
              >
                ✏️ modificata {mins} min fa
              </span>
            );
          })()}
          {canEdit && editWindow && !editWindow.expired && (
            <span
              data-testid="ddt-edit-countdown"
              title="Tempo restante per modificare la bolla. Dopo, la richiesta viene congelata."
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold tabular-nums border transition-colors ${
                editWindow.critical
                  ? 'bg-red-100 text-red-800 border-red-300 animate-pulse'
                  : 'bg-amber-100 text-amber-900 border-amber-300'
              }`}
            >
              ⏱ Modificabile per ancora {String(editWindow.mm).padStart(2,'0')}:{String(editWindow.ss).padStart(2,'0')}
            </span>
          )}
          {canEdit && (
            <button
              data-testid="btn-modifica-ddt"
              onClick={() => navigate(`/richiesta-merce/${id}/modifica`)}
              className="flex items-center gap-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 font-semibold px-4 py-2 rounded-lg shadow-sm"
            >
              <Pencil size={16} /> Modifica
            </button>
          )}
          <button
            data-testid="btn-stampa-ddt"
            onClick={handlePrint}
            className="flex items-center gap-2 bg-[#F5C518] hover:bg-[#E5B418] text-gray-900 font-semibold px-5 py-2 rounded-lg shadow-sm"
          >
            <Printer size={18} /> Stampa DDT
          </button>
        </div>
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
              N°. <strong className="text-lg">{ddt.ddt_number}</strong> DEL <strong>{formatItalianDate(ddt.dispatch_date || addOneDay(ddt.created_at))}</strong>
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
            {sortByCanonicalOrder(ddt.items || [], it => it.product_name).map((it, i) => (
              <tr key={i} className="odd:bg-white even:bg-gray-50">
                <td className="border border-gray-300 px-3 py-2">{it.product_name}</td>
                <td className="border border-gray-300 px-3 py-2 text-center">{it.unit || '—'}</td>
                <td className="border border-gray-300 px-3 py-2 text-center font-semibold">{it.quantity}</td>
              </tr>
            ))}
            {ddt.extra_note && ddt.extra_note.trim() && (
              <tr className="bg-yellow-50">
                <td colSpan={3} className="border border-gray-300 px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-gray-600 font-bold mb-1">Extra</div>
                  <div className="whitespace-pre-wrap text-sm text-gray-900">{ddt.extra_note}</div>
                </td>
              </tr>
            )}
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
