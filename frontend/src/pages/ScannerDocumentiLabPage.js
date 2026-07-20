import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  Check,
  FileImage,
  Plus,
  RotateCcw,
  ScanLine,
  Trash2,
  Upload,
} from 'lucide-react';
import Header from '../components/Header';

const emptyDocument = () => ({
  type: 'ddt',
  supplier: '',
  number: '',
  date: '',
  total: '',
});

const emptyRow = () => ({
  id: `${Date.now()}-${Math.random()}`,
  description: '',
  quantity: '',
  unitPrice: '',
});

const ScannerDocumentiLabPage = () => {
  const navigate = useNavigate();
  const cameraInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [document, setDocument] = useState(emptyDocument);
  const [rows, setRows] = useState([emptyRow()]);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return undefined;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [file]);

  const loadFile = (event) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = '';
    if (!selectedFile) return;
    setFile(selectedFile);
    setCompleted(false);
  };

  const updateDocument = (field, value) => {
    setDocument(current => ({ ...current, [field]: value }));
    setCompleted(false);
  };

  const updateRow = (rowId, field, value) => {
    setRows(current => current.map(row => (
      row.id === rowId ? { ...row, [field]: value } : row
    )));
    setCompleted(false);
  };

  const addRow = () => {
    setRows(current => [...current, emptyRow()]);
    setCompleted(false);
  };

  const removeRow = (rowId) => {
    setRows(current => (
      current.length === 1 ? [emptyRow()] : current.filter(row => row.id !== rowId)
    ));
    setCompleted(false);
  };

  const resetTest = () => {
    setFile(null);
    setDocument(emptyDocument());
    setRows([emptyRow()]);
    setCompleted(false);
  };

  const canComplete = Boolean(file);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />

      <main className="w-full max-w-[1500px] mx-auto px-3 sm:px-6 lg:px-10 py-4 sm:py-6">
        <div className="bg-[#F5C518] border border-yellow-600 rounded-md px-4 py-2.5 mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <ScanLine size={19} className="text-gray-950 shrink-0" aria-hidden="true" />
            <span className="font-bold text-sm text-gray-950 uppercase truncate">Laboratorio / Scanner documenti</span>
          </div>
          <span className="text-xs font-semibold text-gray-800 shrink-0">Nessun dato reale</span>
        </div>

        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-950 uppercase">
              Nuova prova
            </h1>
            <p className="text-sm text-gray-500 mt-1">Acquisizione e correzione manuale</p>
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

        {completed && (
          <div className="mb-5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-md px-4 py-3 flex items-center gap-2 text-sm font-semibold">
            <Check size={18} aria-hidden="true" />
            Prova completata. I dati restano soltanto in questa schermata.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(360px,0.9fr)_minmax(480px,1.1fr)] gap-5 items-start">
          <section className="bg-white border border-gray-300 rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
              <h2 className="font-heading text-base font-bold text-gray-900 uppercase">Documento</h2>
              {file && <span className="text-xs text-gray-500 truncate max-w-[190px]">{file.name}</span>}
            </div>

            <div className="p-4">
              <div className="aspect-[4/3] bg-gray-100 border border-dashed border-gray-400 rounded-md overflow-hidden flex items-center justify-center">
                {previewUrl ? (
                  <img src={previewUrl} alt="Documento acquisito" className="w-full h-full object-contain bg-gray-950" />
                ) : (
                  <div className="text-center px-6">
                    <FileImage size={38} className="mx-auto text-gray-400" aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold text-gray-700">Nessun documento acquisito</p>
                  </div>
                )}
              </div>

              <input
                ref={cameraInputRef}
                data-testid="lab-camera-input"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={loadFile}
                className="hidden"
              />
              <input
                ref={uploadInputRef}
                data-testid="lab-upload-input"
                type="file"
                accept="image/*"
                onChange={loadFile}
                className="hidden"
              />

              <div className="grid grid-cols-2 gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-black text-white px-4 py-3 rounded-md font-bold text-sm"
                >
                  <Camera size={18} aria-hidden="true" />
                  Fotocamera
                </button>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 bg-white hover:bg-gray-50 border border-gray-400 text-gray-800 px-4 py-3 rounded-md font-bold text-sm"
                >
                  <Upload size={18} aria-hidden="true" />
                  Carica foto
                </button>
              </div>
            </div>
          </section>

          <section className="bg-white border border-gray-300 rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="font-heading text-base font-bold text-gray-900 uppercase">Dati riconosciuti</h2>
            </div>

            <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-2">Tipo documento</span>
                <select
                  value={document.type}
                  disabled={!file}
                  onChange={(event) => updateDocument('type', event.target.value)}
                  className="input-touch w-full disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="ddt">DDT</option>
                  <option value="invoice">Fattura</option>
                  <option value="credit_note">Nota di credito</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-2">Fornitore</span>
                <input
                  type="text"
                  value={document.supplier}
                  disabled={!file}
                  onChange={(event) => updateDocument('supplier', event.target.value)}
                  className="input-touch w-full disabled:bg-gray-100"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-2">Numero documento</span>
                <input
                  type="text"
                  value={document.number}
                  disabled={!file}
                  onChange={(event) => updateDocument('number', event.target.value)}
                  className="input-touch w-full disabled:bg-gray-100"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-2">Data</span>
                <input
                  type="date"
                  value={document.date}
                  disabled={!file}
                  onChange={(event) => updateDocument('date', event.target.value)}
                  className="input-touch w-full disabled:bg-gray-100"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="block text-sm font-semibold text-gray-700 mb-2">Totale documento</span>
                <div className="relative max-w-xs">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={document.total}
                    disabled={!file}
                    onChange={(event) => updateDocument('total', event.target.value)}
                    className="input-touch w-full pr-10 disabled:bg-gray-100"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">EUR</span>
                </div>
              </label>
            </div>
          </section>
        </div>

        <section className="mt-5 bg-white border border-gray-300 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-4">
            <h2 className="font-heading text-base font-bold text-gray-900 uppercase">Righe documento</h2>
            <button
              type="button"
              onClick={addRow}
              disabled={!file}
              className="inline-flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-2 rounded-md text-sm font-bold disabled:opacity-40"
            >
              <Plus size={17} aria-hidden="true" />
              Aggiungi riga
            </button>
          </div>

          <div className="p-4 space-y-3">
            {rows.map((row, index) => (
              <div key={row.id} className="grid grid-cols-1 sm:grid-cols-[42px_minmax(220px,1fr)_110px_130px_42px] gap-3 items-end">
                <div className="hidden sm:flex h-[52px] items-center justify-center text-sm font-bold text-gray-500">
                  {index + 1}
                </div>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-600 mb-1.5">Descrizione</span>
                  <input
                    type="text"
                    value={row.description}
                    disabled={!file}
                    onChange={(event) => updateRow(row.id, 'description', event.target.value)}
                    className="input-touch w-full disabled:bg-gray-100"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-600 mb-1.5">Quantita</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.quantity}
                    disabled={!file}
                    onChange={(event) => updateRow(row.id, 'quantity', event.target.value)}
                    className="input-touch w-full disabled:bg-gray-100"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-600 mb-1.5">Prezzo unitario</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.unitPrice}
                    disabled={!file}
                    onChange={(event) => updateRow(row.id, 'unitPrice', event.target.value)}
                    className="input-touch w-full disabled:bg-gray-100"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={!file}
                  title="Elimina riga"
                  aria-label={`Elimina riga ${index + 1}`}
                  className="h-[52px] w-[42px] flex items-center justify-center text-red-600 hover:bg-red-50 rounded-md disabled:opacity-30"
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-5 border-t border-gray-300 pt-5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <button
            type="button"
            onClick={resetTest}
            className="inline-flex items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-3 rounded-md font-bold text-sm"
          >
            <RotateCcw size={18} aria-hidden="true" />
            Azzera prova
          </button>
          <button
            type="button"
            disabled={!canComplete}
            onClick={() => setCompleted(true)}
            className="inline-flex items-center justify-center gap-2 bg-[#F5C518] hover:bg-[#E5B418] border border-yellow-600 text-gray-950 px-5 py-3 rounded-md font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={18} aria-hidden="true" />
            Completa prova
          </button>
        </div>
      </main>
    </div>
  );
};

export default ScannerDocumentiLabPage;
