import React from 'react';

const fmtEur = (n) => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => {
  if (!s) return '';
  try {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  } catch (e) { return s; }
};

// Banconote / monete (deve restare allineato a CASH_DENOMINATIONS in ReportBetaPage.js)
const CASH_DENOMINATIONS = [
  { key: 'big100', label: '100',  value: 100 },
  { key: 'big',    label: '50',   value: 50  },
  { key: 'd20',    label: '20',   value: 20  },
  { key: 'd10',    label: '10',   value: 10  },
  { key: 'd5',     label: '5',    value: 5   },
  { key: 'c2',     label: '2',    value: 2   },
  { key: 'c1',     label: '1',    value: 1   },
  { key: 'c50',    label: '0,50', value: 0.5 },
  { key: 'c20',    label: '0,20', value: 0.2 },
  { key: 'c10',    label: '0,10', value: 0.1 },
];

// Sfondo dei box Riepilogo Cassa. Label nere (bianche su VERS).
const CASH_BOX_STYLE = {
  mattina: { bg: '#f3f4f6', text: '#111827' },
  altro:   { bg: '#ede9fe', text: '#111827' },
  glo:     { bg: '#fef3c7', text: '#111827' },
  just:    { bg: '#ffedd5', text: '#111827' },
  delv:    { bg: '#dcfce7', text: '#111827' },
  bp:      { bg: '#e3c9a1', text: '#111827' },
  sat:     { bg: '#e3c9a1', text: '#111827' },
  ft:      { bg: '#e0f2fe', text: '#111827' },
  pos:     { bg: '#dbeafe', text: '#111827' },
  vers:    { bg: '#111827', text: '#ffffff' },
  arr:     { bg: '#fee2e2', text: '#111827' },
};

const evalNum = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  const s = String(v).trim().replace(',', '.');
  if (s.startsWith('=')) {
    const expr = s.slice(1).trim();
    if (!expr || !/^[\d+\-*/.() \s]*$/.test(expr)) return 0;
    try {
      // eslint-disable-next-line no-new-func
      const n = Function(`"use strict"; return (${expr})`)();
      return Number.isFinite(n) ? n : 0;
    } catch { return 0; }
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
};

export const ClosureDetail = ({ detail }) => {
  const cash = detail.cash || {};
  const bev = detail.beverages || [];
  const cashRows = [
    ['Mattina','mattina', cash.mattina, '+'],
    ['Altro',  'altro',   cash.altro,   '+'],
    ['ARR',    'arr',     cash.arr,     '+'],
    ['GLO',    'glo',     cash.glo,     '−'],
    ['JUST',   'just',    cash.just,    '−'],
    ['DEL',    'delv',    cash.delv,    '−'],
    ['BP',     'bp',      cash.bp,      '−'],
    ['SAT',    'sat',     cash.sat,     '−'],
    ['FT',     'ft',      cash.ft,      '−'],
    ['POS',    'pos',     cash.pos,     '−'],
    ['VERS',   'vers',    cash.vers,    '−'],
  ];
  const spicciRows = [
    { lbl: '5€',   aperti: cash.sp5,  stock: cash.cd5  },
    { lbl: '2€',   aperti: cash.sp2,  stock: cash.cd2  },
    { lbl: '1€',   aperti: cash.sp1,  stock: cash.cd1  },
    { lbl: '0,5€', aperti: cash.sp05, stock: cash.cd05 },
  ];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-gray-900 uppercase mb-1">{fmtDate(detail.date)}</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="bg-gray-900 text-[#F5C518] rounded px-3 py-1.5 font-black">
            CASH SERA €{fmtEur(detail.cash_sera)}
          </div>
          <div className="bg-yellow-50 border border-yellow-300 rounded px-3 py-1.5">
            <span className="text-[10px] uppercase text-yellow-800">Paste tot</span>
            <span className="font-bold ml-2">{detail.paste_count ?? 0}</span>
          </div>
          <div className="bg-yellow-50 border border-yellow-300 rounded px-3 py-1.5">
            <span className="text-[10px] uppercase text-yellow-800">Bevande</span>
            <span className="font-bold ml-2">{detail.bev_total_qty}</span>
            <span className="text-[10px] uppercase text-yellow-800 ml-3">Importo</span>
            <span className="font-bold ml-2">€{fmtEur(detail.bev_total_inc)}</span>
          </div>
        </div>
      </div>

      {/* CASSA — Conta banconote/monete della chiusura */}
      {(() => {
        const banc = cash.cash_banconote || {};
        const rows = CASH_DENOMINATIONS.map(d => {
          const raw = String(banc[d.key] ?? '').trim();
          const n = evalNum(raw);
          const subTot = (!raw || n < 0) ? 0 : n * d.value;
          return { ...d, raw, subTot };
        });
        const total = rows.reduce((s, r) => s + r.subTot, 0);
        const anyValue = rows.some(r => r.raw !== '');
        if (!anyValue) return null;
        return (
          <div>
            <h3 className="text-xs font-bold uppercase text-gray-700 mb-1">Cassa</h3>
            <div className="grid grid-cols-6 sm:grid-cols-11 gap-1 text-xs">
              {rows.map(r => (
                <div key={r.key} className="bg-gray-50 border border-gray-200 rounded p-1.5 flex flex-col items-center">
                  <div className="text-[10px] font-bold text-gray-700">{r.label}</div>
                  <div className="font-black text-gray-900 text-sm">{r.raw || '0'}</div>
                  <div className="text-[9px] text-gray-500 leading-none">
                    {r.subTot > 0 ? `€${fmtEur(r.subTot)}` : '\u00A0'}
                  </div>
                </div>
              ))}
              <div className="bg-gray-900 text-[#F5C518] rounded p-1.5 flex flex-col items-center">
                <div className="text-[10px] font-bold uppercase">Tot</div>
                <div className="font-black text-sm">€{fmtEur(total)}</div>
                <div className="text-[9px] opacity-80">in €</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* RIEPILOGO CASSA */}
      <div>
        <h3 className="text-xs font-bold uppercase text-gray-700 mb-1">Riepilogo Cassa</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-xs">
          {cashRows.map(([label, key, v, sign]) => {
            const st = CASH_BOX_STYLE[key] || { bg: '#f9fafb', text: '#111827' };
            return (
              <div
                key={key}
                className="border border-gray-200 rounded p-1.5"
                style={{ backgroundColor: st.bg }}
              >
                <div
                  className="text-[10px] uppercase font-extrabold"
                  style={{ color: st.text }}
                >
                  {sign} {label}
                </div>
                <div className="font-black" style={{ color: st.text }}>{v || '—'}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs">
          {spicciRows.map(s => {
            const aperti = evalNum(s.aperti);
            const stock = evalNum(s.stock);
            const residuo = stock - aperti;
            const hasStock = s.stock !== undefined && s.stock !== null && s.stock !== '';
            return (
              <div key={s.lbl} className="bg-blue-50 border border-blue-200 rounded p-1.5">
                <div className="text-[10px] uppercase text-blue-800 font-extrabold">Spicci {s.lbl}</div>
                <div className="flex justify-between text-[11px] mt-0.5">
                  <span className="text-gray-700">Aperti: <b className="text-gray-900">{s.aperti || '0'}</b></span>
                  <span className="text-gray-700">Cassetto: <b className="text-gray-900">{hasStock ? s.stock : '—'}</b></span>
                </div>
                <div className="text-[11px] mt-0.5">
                  <span className="text-gray-700">Residuo: </span>
                  <b className={hasStock ? (residuo < 0 ? 'text-rose-700' : 'text-emerald-700') : 'text-gray-400'}>
                    {hasStock ? (Number.isInteger(residuo) ? residuo : residuo.toFixed(2)) : '—'}
                  </b>
                </div>
              </div>
            );
          })}
        </div>
        {cash.paste_text && (
          <details className="mt-2 bg-gray-50 border border-gray-200 rounded p-2">
            <summary className="text-[11px] font-bold cursor-pointer text-gray-700">Paste incollate ({cash.paste_text.split('\n').filter(Boolean).length})</summary>
            <pre className="text-[11px] mt-1 whitespace-pre-wrap font-mono">{cash.paste_text}</pre>
          </details>
        )}
        {detail.paste_unrecognized && detail.paste_unrecognized.length > 0 && (
          <div className="mt-2 bg-rose-50 border border-rose-200 rounded p-2">
            <div className="text-[11px] font-extrabold text-rose-800 uppercase mb-1">
              Paste non riconosciute ({detail.paste_unrecognized.length})
            </div>
            <div className="text-[10px] text-rose-700 mb-1.5">
              Righe a cui è stato assegnato un prezzo manuale (o lasciate a 0).
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-rose-200 rounded bg-white">
                <thead className="bg-rose-100">
                  <tr>
                    <th className="text-left p-1.5 w-10">#</th>
                    <th className="text-left p-1.5">Riga</th>
                    <th className="text-right p-1.5 w-24">Prezzo €</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.paste_unrecognized.map(u => (
                    <tr key={u.idx} className="border-t border-rose-100">
                      <td className="p-1.5 text-rose-700 font-bold">{u.idx + 1}</td>
                      <td className="p-1.5 font-mono">{u.text}</td>
                      <td className="p-1.5 text-right">
                        {u.manual_price > 0 ? (
                          <span className="font-black text-emerald-700">€{fmtEur(u.manual_price)}</span>
                        ) : (
                          <span className="text-rose-600 italic">non assegnato</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* BEVANDE */}
      {bev.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase text-gray-700 mb-1">Bevande</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-gray-200 rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-1">Bevanda</th>
                  <th className="text-center p-1">Mattina</th>
                  <th className="text-center p-1">In/Usc</th>
                  <th className="text-center p-1">Scarti</th>
                  <th className="text-center p-1">Sera</th>
                  <th className="text-center p-1 bg-yellow-50">Vendute</th>
                  <th className="text-center p-1 bg-yellow-50">€</th>
                </tr>
              </thead>
              <tbody>
                {bev.map(b => (
                  <tr key={b.sigla} className="border-t border-gray-100">
                    <td className="p-1">
                      <span className="font-extrabold">{b.sigla}</span>
                      <span className="text-gray-400 text-[10px] ml-1">{b.name}</span>
                    </td>
                    <td className="text-center p-1">{b.mattina || '—'}</td>
                    <td className="text-center p-1">{b.inUsc || '—'}</td>
                    <td className="text-center p-1">{b.scarti || '—'}</td>
                    <td className="text-center p-1">{b.sera || '—'}</td>
                    <td className="text-center p-1 font-black bg-yellow-50">{b.quantita}</td>
                    <td className="text-center p-1 font-bold bg-yellow-50">€{fmtEur(b.incasso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* COMMENTI */}
      {cash.comments && Object.keys(cash.comments).length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase text-gray-700 mb-1">Note Cassa</h3>
          <ul className="text-xs space-y-1">
            {Object.entries(cash.comments).map(([k, v]) => (
              <li key={k} className="bg-amber-50 border border-amber-300 rounded p-2">
                <span className="font-bold uppercase text-amber-900">{k}:</span>
                <span className="ml-2 text-amber-900">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ClosureDetail;
