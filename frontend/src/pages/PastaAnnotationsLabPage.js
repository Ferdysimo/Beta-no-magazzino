import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  RefreshCw,
  Search,
  Tags,
} from 'lucide-react';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';
import { filterPastaAnnotations } from '../utils/laboratory';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const inputDate = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const initialPeriod = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  return { start: inputDate(start), end: inputDate(end) };
};

const breakdownText = (values) => (
  Object.entries(values || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => `${label} ${count}`)
    .join(' · ')
);

const PastaAnnotationsLabPage = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [period, setPeriod] = useState(initialPeriod);
  const [restaurantId, setRestaurantId] = useState('');
  const [pasta, setPasta] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`${API}/lab/pasta-annotations`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          start_date: period.start,
          end_date: period.end,
          ...(restaurantId ? { restaurant_id: restaurantId } : {}),
        },
      });
      setData(response.data);
    } catch (requestError) {
      setError(
        requestError.response?.data?.detail
        || 'Impossibile caricare le annotazioni.',
      );
    } finally {
      setLoading(false);
    }
  }, [period.start, period.end, restaurantId, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pastaOptions = useMemo(
    () => Object.keys(data?.pasta_counts || {}).sort(),
    [data],
  );
  const filteredAnnotations = useMemo(
    () => filterPastaAnnotations(data?.annotations, search, pasta),
    [data, search, pasta],
  );
  const displayedCount = useCallback(
    item => Number(pasta ? item.pasta_counts?.[pasta] : item.count) || 0,
    [pasta],
  );
  const displayedShare = useCallback((item) => {
    if (!pasta) return Number(item.recognized_share_percent || 0);
    const pastaTotal = Number(data?.pasta_counts?.[pasta] || 0);
    return pastaTotal ? displayedCount(item) / pastaTotal * 100 : 0;
  }, [data, displayedCount, pasta]);
  const displayedLocations = useCallback(
    item => (pasta ? item.pasta_location_counts?.[pasta] : item.location_counts) || {},
    [pasta],
  );
  const displayedExamples = useCallback(
    item => (pasta ? item.pasta_examples?.[pasta] : item.examples) || [],
    [pasta],
  );
  const filteredOccurrences = useMemo(
    () => filteredAnnotations.reduce((total, item) => total + displayedCount(item), 0),
    [displayedCount, filteredAnnotations],
  );
  const summary = data?.summary || {};

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />

      <main className="w-full max-w-[1500px] mx-auto px-3 sm:px-6 lg:px-10 py-4 sm:py-6">
        <div className="bg-[#F5C518] border border-yellow-600 rounded-md px-4 py-2.5 mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Tags size={19} className="text-gray-950 shrink-0" aria-hidden="true" />
            <span className="font-bold text-sm text-gray-950 uppercase truncate">
              Laboratorio / Annotazioni paste
            </span>
          </div>
          <span className="text-xs font-semibold text-gray-800 shrink-0">Sola lettura</span>
        </div>

        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-950 uppercase">
              Annotazioni paste
            </h1>
            <p className="text-sm text-gray-500 mt-1">Ordini validi e riconosciuti</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/laboratorio')}
            className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-2 rounded-md font-semibold text-sm shrink-0"
          >
            <ArrowLeft size={17} aria-hidden="true" />
            <span className="hidden sm:inline">Laboratorio</span>
          </button>
        </div>

        <section className="border-y border-gray-300 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto] gap-3 items-end">
            <label className="block">
              <span className="block text-xs font-bold text-gray-600 uppercase mb-1.5">Dal</span>
              <input
                type="date"
                value={period.start}
                max={period.end}
                onChange={(event) => setPeriod(current => ({ ...current, start: event.target.value }))}
                className="input-touch w-full"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-gray-600 uppercase mb-1.5">Al</span>
              <input
                type="date"
                value={period.end}
                min={period.start}
                onChange={(event) => setPeriod(current => ({ ...current, end: event.target.value }))}
                className="input-touch w-full"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-gray-600 uppercase mb-1.5">Locale</span>
              <select
                value={restaurantId}
                onChange={(event) => setRestaurantId(event.target.value)}
                className="input-touch w-full"
              >
                <option value="">Tutti i locali</option>
                {(data?.restaurants || []).map(item => (
                  <option key={item.id} value={item.id}>{item.location}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              title="Aggiorna dati"
              aria-label="Aggiorna dati"
              className="h-[52px] w-full lg:w-[52px] inline-flex items-center justify-center bg-gray-900 hover:bg-black text-white rounded-md disabled:opacity-50"
            >
              <RefreshCw size={19} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
          </div>
        </section>

        {error && (
          <div className="mt-5 bg-red-50 border border-red-300 text-red-900 rounded-md px-4 py-3 text-sm font-semibold">
            {error}
          </div>
        )}

        <section className="grid grid-cols-2 lg:grid-cols-4 border-b border-gray-300 mt-5">
          <div className="py-4 pr-3 border-r border-gray-300">
            <p className="text-xs font-bold uppercase text-gray-500">Paste riconosciute</p>
            <p className="text-2xl font-bold text-gray-950 mt-1">{summary.recognized_orders || 0}</p>
          </div>
          <div className="py-4 px-3 lg:px-5 lg:border-r border-gray-300">
            <p className="text-xs font-bold uppercase text-gray-500">Con annotazione</p>
            <p className="text-2xl font-bold text-gray-950 mt-1">{summary.annotated_orders || 0}</p>
          </div>
          <div className="py-4 pr-3 lg:px-5 border-r border-gray-300 border-t lg:border-t-0">
            <p className="text-xs font-bold uppercase text-gray-500">Incidenza</p>
            <p className="text-2xl font-bold text-gray-950 mt-1">
              {Number(summary.annotation_rate_percent || 0).toLocaleString('it-IT')}%
            </p>
          </div>
          <div className="py-4 pl-3 lg:pl-5 border-t lg:border-t-0">
            <p className="text-xs font-bold uppercase text-gray-500">Annotazioni distinte</p>
            <p className="text-2xl font-bold text-gray-950 mt-1">{data?.annotations?.length || 0}</p>
          </div>
        </section>

        <div className="mt-5 flex flex-col md:flex-row md:items-end gap-3">
          <label className="block flex-1">
            <span className="block text-xs font-bold text-gray-600 uppercase mb-1.5">Cerca annotazione</span>
            <div className="relative">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="input-touch w-full pl-10"
              />
            </div>
          </label>
          <label className="block md:w-64">
            <span className="block text-xs font-bold text-gray-600 uppercase mb-1.5">Pasta</span>
            <select
              value={pasta}
              onChange={(event) => setPasta(event.target.value)}
              className="input-touch w-full"
            >
              <option value="">Tutte le paste</option>
              {pastaOptions.map(sigla => (
                <option key={sigla} value={sigla}>{sigla}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={19} className="text-gray-700" aria-hidden="true" />
            <h2 className="font-heading text-lg font-bold text-gray-950 uppercase">Frequenza</h2>
          </div>
          <span className="text-sm font-semibold text-gray-500">
            {filteredAnnotations.length} voci · {filteredOccurrences} occorrenze
          </span>
        </div>

        <section className="mt-3 bg-white border border-gray-300 rounded-md overflow-hidden">
          {loading ? (
            <div className="min-h-[260px] flex items-center justify-center">
              <RefreshCw size={26} className="animate-spin text-gray-500" aria-label="Caricamento" />
            </div>
          ) : filteredAnnotations.length === 0 ? (
            <div className="min-h-[220px] flex flex-col items-center justify-center text-center px-6">
              <CalendarDays size={30} className="text-gray-400" aria-hidden="true" />
              <p className="mt-3 font-semibold text-gray-700">Nessuna annotazione nel periodo</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead className="bg-gray-100 border-b border-gray-300">
                  <tr className="text-xs uppercase text-gray-600">
                    <th className="px-4 py-3 font-bold">Annotazione</th>
                    <th className="px-4 py-3 font-bold text-right">Uscite</th>
                    <th className="px-4 py-3 font-bold text-right">% paste</th>
                    <th className="px-4 py-3 font-bold">Paste</th>
                    <th className="px-4 py-3 font-bold">Locali</th>
                    <th className="px-4 py-3 font-bold">Riscontri</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredAnnotations.map(item => (
                    <tr key={item.annotation} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <p className="font-bold text-gray-950">{item.annotation}</p>
                        {(item.raw_variants || []).length > 1 && (
                          <p className="text-xs text-gray-500 mt-1">
                            {(item.raw_variants || []).map(variant => variant.value).join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-gray-950">{displayedCount(item)}</td>
                      <td className="px-4 py-4 text-right text-gray-700">
                        {displayedShare(item).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        {breakdownText(item.pasta_counts)}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        {breakdownText(displayedLocations(item))}
                      </td>
                      <td className="px-4 py-4">
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold text-gray-800">
                            {displayedExamples(item).length} esempi
                          </summary>
                          <div className="mt-2 space-y-1.5">
                            {displayedExamples(item).map((example, index) => (
                              <p
                                key={`${example.order_id || example.order_number}-${index}`}
                                className="text-xs text-gray-600 whitespace-nowrap"
                              >
                                {example.business_date} · {example.location} · {example.pasta_sigla} · {example.annotation_raw}
                              </p>
                            ))}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="mt-4 text-xs text-gray-500 flex items-center justify-between gap-4">
          <span>Parser annotazioni v{data?.parser_version || 1}</span>
          <span>{data?.data_scope === 'read_only_operational_history' ? 'Storico operativo in sola lettura' : ''}</span>
        </div>
      </main>
    </div>
  );
};

export default PastaAnnotationsLabPage;
