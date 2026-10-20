import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Building2, RefreshCw, Save } from 'lucide-react';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const SPICCI_FIELDS = [
  { key: 'sp5', label: '5 €', multiplier: 50 },
  { key: 'sp2', label: '2 €', multiplier: 50 },
  { key: 'sp1', label: '1 €', multiplier: 25 },
  { key: 'sp05', label: '0,50 €', multiplier: 20 },
];

export const CASSETTO_FIELDS = [
  { key: 'cd5', label: '5 €', spicciKey: 'sp5' },
  { key: 'cd2', label: '2 €', spicciKey: 'sp2' },
  { key: 'cd1', label: '1 €', spicciKey: 'sp1' },
  { key: 'cd05', label: '0,50 €', spicciKey: 'sp05' },
];

const ALL_KEYS = [
  ...SPICCI_FIELDS.map(field => field.key),
  ...CASSETTO_FIELDS.map(field => field.key),
];

const sanitizeNumberExpression = value => String(value ?? '')
  .replace(/[^0-9+\-*/.()\s,=]/g, '');

export const evaluateSpicciValue = value => {
  if (value === '' || value === null || value === undefined) return 0;
  let expression = String(value).trim().replace(/,/g, '.');
  if (expression.startsWith('=')) expression = expression.slice(1).trim();
  if (!expression || !/^[\d+\-*/.()\s]*$/.test(expression)) return 0;
  try {
    // La whitelist sopra mantiene la stessa semantica del Report senza
    // consentire codice o identificatori.
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expression})`)();
    return Number.isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
};

const compactNumber = value => (
  Number.isInteger(value) ? String(value) : String(+Number(value).toFixed(2))
);

const money = value => Number(value || 0).toLocaleString('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const requestHeaders = (token, restaurantId) => ({
  Authorization: `Bearer ${token}`,
  'X-Restaurant-Id': restaurantId,
  'X-Admin-Restaurant-Id': restaurantId,
});

const emptyValues = () => Object.fromEntries(ALL_KEYS.map(key => [key, '']));

const ReportSpicciGlobalePage = () => {
  const navigate = useNavigate();
  const { token, isFederico } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [reports, setReports] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null);

  const todayLabel = useMemo(() => new Date().toLocaleDateString('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }), []);

  const loadReports = useCallback(async () => {
    if (!token || !isFederico) return;
    setLoading(true);
    setLoadError('');
    setEditing(null);
    try {
      const restaurantResponse = await axios.get(`${API}/admin/restaurants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const list = (restaurantResponse.data || [])
        .filter(item => item.role === 'restaurant')
        .sort((a, b) => String(a.location || a.username).localeCompare(
          String(b.location || b.username),
          'it',
        ));
      setRestaurants(list);

      const settled = await Promise.allSettled(list.map(async restaurant => {
        const response = await axios.get(`${API}/cash/daily`, {
          headers: requestHeaders(token, restaurant.id),
        });
        return { restaurant, response };
      }));

      const nextReports = {};
      settled.forEach((result, index) => {
        const restaurant = list[index];
        if (result.status === 'fulfilled') {
          const source = result.value.response.data?.data || {};
          nextReports[restaurant.id] = {
            values: Object.fromEntries(ALL_KEYS.map(key => [key, source[key] || ''])),
            revision: result.value.response.data?.revision || '',
            dirty: false,
            dirtyKeys: [],
            editVersion: 0,
            saving: false,
            message: '',
            error: '',
          };
        } else {
          nextReports[restaurant.id] = {
            values: null,
            revision: '',
            dirty: false,
            dirtyKeys: [],
            editVersion: 0,
            saving: false,
            message: '',
            error: 'Impossibile caricare gli spicci di questo locale.',
          };
        }
      });
      setReports(nextReports);
    } catch (error) {
      console.error('load global spicci report', error);
      setRestaurants([]);
      setReports({});
      setLoadError('Impossibile caricare l’elenco dei locali.');
    } finally {
      setLoading(false);
    }
  }, [isFederico, token]);

  React.useEffect(() => {
    loadReports();
  }, [loadReports]);

  const updateValue = (restaurantId, key, value) => {
    setReports(current => {
      const row = current[restaurantId];
      if (!row) return current;
      return {
        ...current,
        [restaurantId]: {
          ...row,
          values: { ...row.values, [key]: value },
          dirty: true,
          dirtyKeys: row.dirtyKeys.includes(key) ? row.dirtyKeys : [...row.dirtyKeys, key],
          editVersion: row.editVersion + 1,
          message: '',
          error: '',
        },
      };
    });
  };

  const startCassettoEdit = (restaurantId, field) => {
    const values = reports[restaurantId]?.values || emptyValues();
    const raw = values[field.key];
    const residual = raw === '' || raw === null || raw === undefined
      ? ''
      : compactNumber(
        evaluateSpicciValue(raw) - evaluateSpicciValue(values[field.spicciKey]),
      );
    setEditing({ restaurantId, fieldKey: field.key, value: residual });
  };

  const commitCassettoEdit = (restaurantId, field) => {
    if (!editing || editing.restaurantId !== restaurantId || editing.fieldKey !== field.key) return;
    const values = reports[restaurantId]?.values || emptyValues();
    const cleaned = sanitizeNumberExpression(editing.value);
    const baseValue = cleaned.trim() === ''
      ? ''
      : compactNumber(
        evaluateSpicciValue(cleaned) + evaluateSpicciValue(values[field.spicciKey]),
      );
    updateValue(restaurantId, field.key, baseValue);
    setEditing(null);
  };

  const saveRestaurant = async (restaurantId) => {
    const snapshot = reports[restaurantId];
    if (!snapshot || !snapshot.dirty || snapshot.saving) return;
    setReports(current => ({
      ...current,
      [restaurantId]: { ...current[restaurantId], saving: true, message: '', error: '' },
    }));
    try {
      const payload = {
        target_restaurant_id: restaurantId,
        revision: snapshot.revision,
        ...Object.fromEntries(snapshot.dirtyKeys.map(key => [key, snapshot.values[key] || ''])),
      };
      const response = await axios.put(`${API}/cash/daily`, payload, {
        headers: requestHeaders(token, restaurantId),
      });
      setReports(current => {
        const currentRow = current[restaurantId];
        const changedWhileSaving = currentRow.editVersion !== snapshot.editVersion;
        return {
          ...current,
          [restaurantId]: {
            ...currentRow,
            revision: response.data?.revision || currentRow.revision,
            dirty: changedWhileSaving,
            dirtyKeys: changedWhileSaving ? currentRow.dirtyKeys : [],
            saving: false,
            message: changedWhileSaving ? 'Salvato, restano modifiche più recenti.' : 'Salvato.',
            error: '',
          },
        };
      });
    } catch (error) {
      console.error('save global spicci report', error);
      setReports(current => ({
        ...current,
        [restaurantId]: {
          ...current[restaurantId],
          saving: false,
          error: error.response?.data?.detail || 'Errore durante il salvataggio.',
          message: '',
        },
      }));
    }
  };

  if (!isFederico) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="mx-auto max-w-4xl p-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            Accesso riservato all’account Federico.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        <button
          type="button"
          data-testid="global-spicci-back-home"
          onClick={() => navigate('/home')}
          className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-950"
        >
          <ArrowLeft size={16} /> Home
        </button>

        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Tutti i locali</p>
            <h1 className="font-heading text-3xl font-bold uppercase text-gray-950">Report spicci globale</h1>
            <p className="mt-1 text-sm capitalize text-gray-500">{todayLabel}</p>
          </div>
          <button
            type="button"
            data-testid="global-spicci-refresh"
            onClick={loadReports}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm hover:border-blue-400 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Aggiornamento…' : 'Aggiorna tutto'}
          </button>
        </div>

        {loadError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            {loadError}
          </div>
        )}

        {loading && restaurants.length === 0 ? (
          <div className="rounded-xl border border-gray-300 bg-white p-12 text-center text-sm text-gray-500 shadow-sm">
            Caricamento degli spicci di tutti i locali…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {restaurants.map(restaurant => {
              const report = reports[restaurant.id];
              const values = report?.values || emptyValues();
              return (
                <section
                  key={restaurant.id}
                  data-testid={`global-spicci-card-${restaurant.id}`}
                  className={`overflow-hidden rounded-xl border bg-white shadow-sm ${
                    report?.dirty ? 'border-amber-400 ring-1 ring-amber-200' : 'border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-900 px-4 py-3 text-white">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                        <Building2 size={19} />
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-bold">{restaurant.location || restaurant.username}</h2>
                        <p className="text-[11px] uppercase tracking-wider text-gray-300">
                          {report?.dirty ? 'Modifiche non salvate' : 'Allineato al Report'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {report?.error && !report?.values ? (
                    <div className="p-5 text-sm font-semibold text-red-700">{report.error}</div>
                  ) : (
                    <div className="p-4">
                      {report?.error && (
                        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                          {report.error}
                        </div>
                      )}

                      <div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-gray-700">Rotolini nel cassetto</h3>
                          <div className="grid grid-cols-4 gap-2">
                            {CASSETTO_FIELDS.map(field => {
                              const isEditing = editing?.restaurantId === restaurant.id
                                && editing?.fieldKey === field.key;
                              const raw = values[field.key];
                              const residual = raw === '' || raw === null || raw === undefined
                                ? ''
                                : compactNumber(
                                  evaluateSpicciValue(raw)
                                  - evaluateSpicciValue(values[field.spicciKey]),
                                );
                              return (
                                <label key={field.key} className="min-w-0 text-center">
                                  <span className="mb-1 block text-[11px] font-bold text-gray-700">{field.label}</span>
                                  <input
                                    data-testid={`global-cassetto-${restaurant.id}-${field.key}`}
                                    type="text"
                                    inputMode="decimal"
                                    value={isEditing ? editing.value : residual}
                                    onFocus={() => startCassettoEdit(restaurant.id, field)}
                                    onChange={event => setEditing(current => ({
                                      ...(current || { restaurantId: restaurant.id, fieldKey: field.key }),
                                      value: sanitizeNumberExpression(event.target.value),
                                    }))}
                                    onBlur={event => {
                                      if (event.currentTarget.dataset.cancelled === 'true') {
                                        delete event.currentTarget.dataset.cancelled;
                                        return;
                                      }
                                      commitCassettoEdit(restaurant.id, field);
                                    }}
                                    onKeyDown={event => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        event.currentTarget.blur();
                                      } else if (event.key === 'Escape') {
                                        event.preventDefault();
                                        event.currentTarget.dataset.cancelled = 'true';
                                        setEditing(null);
                                        event.currentTarget.blur();
                                      }
                                    }}
                                    placeholder="—"
                                    className={`h-10 w-full rounded-md border bg-white px-1 text-center font-mono text-base font-bold focus:outline-none focus:ring-2 ${
                                      Number(residual) < 0
                                        ? 'border-red-300 text-red-700 focus:border-red-500 focus:ring-red-200'
                                        : 'border-gray-300 text-gray-950 focus:border-amber-500 focus:ring-amber-200'
                                    }`}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex min-h-10 items-center justify-between gap-3 border-t border-gray-200 pt-3">
                        <div className="text-xs">
                          {report?.error ? (
                            <span className="font-semibold text-red-700">{report.error}</span>
                          ) : report?.message ? (
                            <span className="font-semibold text-emerald-700">{report.message}</span>
                          ) : (
                            <span className="text-gray-400">I valori modificano direttamente il cassetto del Report di oggi.</span>
                          )}
                        </div>
                        <button
                          type="button"
                          data-testid={`global-spicci-save-${restaurant.id}`}
                          onClick={() => saveRestaurant(restaurant.id)}
                          disabled={!report?.dirty || report?.saving}
                          className="flex shrink-0 items-center gap-2 rounded-lg bg-[#F5C518] px-4 py-2 text-sm font-extrabold text-gray-950 hover:bg-[#E5B418] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                        >
                          <Save size={16} />
                          {report?.saving ? 'Salvataggio…' : 'Salva locale'}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default ReportSpicciGlobalePage;
