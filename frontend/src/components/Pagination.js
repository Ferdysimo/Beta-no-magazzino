import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Paginatore compatto per liste documenti (Chiusure, Fatture, Versamenti).
 *  - Mostra "X di Y" + Prev/Next + selettore di pagina.
 *  - Si nasconde da solo se gli elementi sono <= pageSize.
 *  - Non gestisce dati: solo controlli. La pagina chiamante slice() la lista.
 *
 * Uso:
 *   const [page, setPage] = useState(1);
 *   const pageSize = 10;
 *   const total = items.length;
 *   const visible = items.slice((page-1)*pageSize, page*pageSize);
 *   ...
 *   <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
 */
const Pagination = ({ page, pageSize, total, onChange, testIdPrefix = 'pg' }) => {
  if (!total || total <= pageSize) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  const go = (p) => {
    const next = Math.min(Math.max(1, p), totalPages);
    if (next === safePage) return;
    onChange(next);
    // Scroll-to-top dolce così l'utente vede l'inizio della nuova pagina.
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch { /* no-op */ }
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 mt-4 px-1 py-2 text-sm text-gray-700"
      data-testid={`${testIdPrefix}-bar`}
    >
      <div className="text-xs sm:text-sm text-gray-500">
        {from}–{to} di <strong className="text-gray-700">{total}</strong>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid={`${testIdPrefix}-prev`}
          onClick={() => go(safePage - 1)}
          disabled={safePage <= 1}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium"
        >
          <ChevronLeft size={16} /> Prec.
        </button>
        <select
          data-testid={`${testIdPrefix}-select`}
          value={safePage}
          onChange={(e) => go(parseInt(e.target.value, 10))}
          className="px-2 py-1.5 rounded border border-gray-300 bg-white text-xs font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-yellow-300"
        >
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <option key={p} value={p}>Pagina {p} / {totalPages}</option>
          ))}
        </select>
        <button
          type="button"
          data-testid={`${testIdPrefix}-next`}
          onClick={() => go(safePage + 1)}
          disabled={safePage >= totalPages}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium"
        >
          Succ. <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
