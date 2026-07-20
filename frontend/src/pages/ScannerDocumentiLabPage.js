import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { createWorker, OEM } from 'tesseract.js';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Camera,
  Check,
  FileImage,
  LoaderCircle,
  Plus,
  RotateCcw,
  ScanLine,
  Trash2,
  Upload,
} from 'lucide-react';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const OCR_ASSET_ROOT = `${process.env.PUBLIC_URL || ''}/tesseract`;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const emptyDocument = () => ({
  type: 'ddt',
  supplierId: '',
  supplierName: '',
  supplierSourceText: '',
  supplierConfidence: 0,
  number: '',
  date: '',
  total: '',
});

const emptyRow = () => ({
  id: `${Date.now()}-${Math.random()}`,
  sourceText: '',
  sourceDescription: '',
  productId: '',
  productName: '',
  productConfidence: 0,
  quantity: '',
  unitPrice: '',
  lineTotal: '',
});

const asInputValue = value => (
  value === null || value === undefined ? '' : String(value).replace('.', ',')
);

const asOptionalNumber = (value) => {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const confidenceStyle = (value) => {
  if (value >= 85) return 'bg-emerald-100 text-emerald-800 border-emerald-300';
  if (value >= 60) return 'bg-amber-100 text-amber-900 border-amber-300';
  return 'bg-red-100 text-red-800 border-red-300';
};

const errorMessage = (error, fallback) => (
  error?.response?.data?.detail
  || (typeof error === 'string' ? error : error?.message)
  || fallback
);

const fingerprintFile = async (file) => {
  if (!window.crypto?.subtle) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }
  const digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
};

const ScannerDocumentiLabPage = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const cameraInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const workerRef = useRef(null);
  const mountedRef = useRef(true);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [catalog, setCatalog] = useState({
    suppliers: [],
    products: [],
    learning: { confirmed_scans: 0, learned_aliases: 0 },
  });
  const [document, setDocument] = useState(emptyDocument);
  const [rows, setRows] = useState([emptyRow()]);
  const [scan, setScan] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (workerRef.current) {
        workerRef.current.terminate().catch(() => {});
        workerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return undefined;
    }
    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    const loadContext = async () => {
      try {
        const response = await axios.get(
          `${API}/lab/document-scanner/context`,
          { headers },
        );
        if (!cancelled) setCatalog(response.data);
      } catch (loadError) {
        if (!cancelled) {
          setError(errorMessage(loadError, 'Cataloghi non disponibili'));
        }
      }
    };
    loadContext();
    return () => {
      cancelled = true;
    };
  }, [headers]);

  const updateProgress = (event) => {
    if (!mountedRef.current) return;
    const translated = {
      'loading tesseract core': 'Preparazione motore OCR',
      'initializing tesseract': 'Inizializzazione OCR',
      'loading language traineddata': 'Caricamento lingua italiana',
      'initializing api': 'Preparazione lettura',
      'recognizing text': 'Lettura del documento',
    };
    setStatusText(translated[event.status] || 'Analisi immagine');
    if (Number.isFinite(event.progress)) {
      setProgress(Math.round(event.progress * 100));
    }
  };

  const getWorker = async () => {
    if (workerRef.current) return workerRef.current;
    const worker = await createWorker('ita', OEM.LSTM_ONLY, {
      workerPath: `${OCR_ASSET_ROOT}/worker.min.js`,
      corePath: `${OCR_ASSET_ROOT}/core`,
      langPath: `${OCR_ASSET_ROOT}/lang`,
      logger: updateProgress,
    });
    workerRef.current = worker;
    return worker;
  };

  const applyDraft = (draft) => {
    const nextDocument = draft.document || {};
    setDocument({
      type: nextDocument.type || 'ddt',
      supplierId: nextDocument.supplier_id || '',
      supplierName: nextDocument.supplier_name || '',
      supplierSourceText: nextDocument.supplier_source_text || '',
      supplierConfidence: nextDocument.supplier_confidence || 0,
      number: nextDocument.number || '',
      date: nextDocument.date || '',
      total: asInputValue(nextDocument.total),
    });
    setRows((draft.rows || []).length ? draft.rows.map((row, index) => ({
      id: `${draft.scan_id}-${index}`,
      sourceText: row.source_text || '',
      sourceDescription: row.source_description || '',
      productId: row.product_id || '',
      productName: row.product_name || '',
      productConfidence: row.product_confidence || 0,
      quantity: asInputValue(row.quantity),
      unitPrice: asInputValue(row.unit_price),
      lineTotal: asInputValue(row.line_total),
    })) : [emptyRow()]);
    setScan(draft);
  };

  const scanFile = async (selectedFile) => {
    setPhase('ocr');
    setProgress(0);
    setStatusText('Preparazione immagine');
    setError('');
    setCompleted(false);
    setScan(null);
    setDocument(emptyDocument());
    setRows([emptyRow()]);
    try {
      const fingerprint = await fingerprintFile(selectedFile);
      const worker = await getWorker();
      const result = await worker.recognize(selectedFile, { rotateAuto: true });
      const ocrText = result?.data?.text?.trim();
      if (!ocrText) {
        throw new Error('Il documento non contiene testo leggibile');
      }
      if (!mountedRef.current) return;
      setPhase('matching');
      setStatusText('Confronto con fornitori e prodotti');
      setProgress(100);
      const response = await axios.post(
        `${API}/lab/document-scanner/analyze`,
        {
          ocr_text: ocrText,
          ocr_confidence: result.data.confidence,
          file_name: selectedFile.name,
          file_fingerprint: fingerprint,
        },
        { headers },
      );
      if (!mountedRef.current) return;
      applyDraft(response.data);
      setPhase('ready');
      setStatusText('');
    } catch (scanError) {
      if (!mountedRef.current) return;
      setPhase('error');
      setError(errorMessage(scanError, 'Lettura del documento non riuscita'));
    }
  };

  const loadFile = (event) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = '';
    if (!selectedFile) return;
    if (!selectedFile.type.startsWith('image/')) {
      setError('Seleziona una fotografia o un file immagine');
      return;
    }
    if (selectedFile.size > MAX_IMAGE_BYTES) {
      setError('Immagine troppo grande: massimo 15 MB');
      return;
    }
    setFile(selectedFile);
    scanFile(selectedFile);
  };

  const updateDocument = (field, value) => {
    setDocument(current => ({ ...current, [field]: value }));
    setCompleted(false);
  };

  const updateSupplier = (supplierId) => {
    const supplier = catalog.suppliers.find(item => item.id === supplierId);
    setDocument(current => ({
      ...current,
      supplierId,
      supplierName: supplier?.name || '',
      supplierConfidence: supplierId === current.supplierId
        ? current.supplierConfidence
        : 100,
    }));
    setCompleted(false);
  };

  const updateRow = (rowId, field, value) => {
    setRows(current => current.map(row => (
      row.id === rowId ? { ...row, [field]: value } : row
    )));
    setCompleted(false);
  };

  const updateRowProduct = (rowId, productId) => {
    const product = catalog.products.find(item => item.id === productId);
    setRows(current => current.map(row => (
      row.id === rowId
        ? {
          ...row,
          productId,
          productName: product?.name || '',
          productConfidence: productId === row.productId ? row.productConfidence : 100,
        }
        : row
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
    setScan(null);
    setPhase('idle');
    setProgress(0);
    setStatusText('');
    setError('');
    setCompleted(false);
  };

  const retryScan = () => {
    if (file) scanFile(file);
  };

  const saveFeedback = async () => {
    if (!scan) return;
    setPhase('saving');
    setError('');
    try {
      const response = await axios.post(
        `${API}/lab/document-scanner/feedback`,
        {
          scan_id: scan.scan_id,
          ocr_text_sha256: scan.ocr_text_sha256,
          file_fingerprint: scan.file_fingerprint || '',
          ocr_confidence: scan.ocr_confidence,
          document_type: document.type,
          supplier_id: document.supplierId || null,
          supplier_source_text: (
            document.supplierSourceText
            || scan.document?.supplier_candidates?.[0]?.source_text
            || ''
          ),
          document_number: document.number,
          document_date: document.date,
          document_total: asOptionalNumber(document.total),
          rows: rows.map(row => ({
            source_text: row.sourceText,
            source_description: row.sourceDescription,
            product_id: row.productId || null,
            quantity: asOptionalNumber(row.quantity),
            unit_price: asOptionalNumber(row.unitPrice),
            line_total: asOptionalNumber(row.lineTotal),
          })),
        },
        { headers },
      );
      setCatalog(current => ({
        ...current,
        learning: {
          confirmed_scans: current.learning.confirmed_scans
            + (response.data.already_recorded ? 0 : 1),
          learned_aliases: current.learning.learned_aliases
            + (response.data.learned_supplier ? 1 : 0)
            + (response.data.learned_products || 0),
        },
      }));
      setCompleted(true);
      setPhase('ready');
    } catch (saveError) {
      setPhase('ready');
      setError(errorMessage(saveError, 'Conferma non salvata'));
    }
  };

  const busy = ['ocr', 'matching', 'saving'].includes(phase);
  const canComplete = Boolean(file && scan && phase === 'ready');

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />

      <main className="w-full max-w-[1540px] mx-auto px-3 sm:px-6 lg:px-10 py-4 sm:py-6">
        <div className="bg-[#F5C518] border border-yellow-600 rounded-md px-4 py-2.5 mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <ScanLine size={19} className="text-gray-950 shrink-0" aria-hidden="true" />
            <span className="font-bold text-sm text-gray-950 uppercase truncate">
              Laboratorio / Scanner documenti
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-900 shrink-0">
            <Brain size={16} aria-hidden="true" />
            <span>{catalog.learning.confirmed_scans} prove</span>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-950 uppercase">
              Lettura documento
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {catalog.suppliers.length} fornitori · {catalog.products.length} prodotti
            </p>
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

        {busy && phase !== 'saving' && (
          <div className="mb-5 bg-white border border-gray-300 rounded-md px-4 py-3">
            <div className="flex items-center justify-between gap-4 text-sm font-semibold text-gray-800">
              <span className="inline-flex items-center gap-2">
                <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
                {statusText}
              </span>
              <span>{progress}%</span>
            </div>
            <div className="mt-2 h-2 bg-gray-200 rounded-sm overflow-hidden">
              <div
                className="h-full bg-[#F5C518] transition-[width] duration-200"
                style={{ width: `${Math.max(4, progress)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 bg-red-50 border border-red-300 text-red-900 rounded-md px-4 py-3 flex items-center justify-between gap-3 text-sm font-semibold">
            <span className="inline-flex items-center gap-2">
              <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
              {error}
            </span>
            {file && phase === 'error' && (
              <button
                type="button"
                onClick={retryScan}
                className="bg-red-100 hover:bg-red-200 px-3 py-2 rounded-md shrink-0"
              >
                Riprova
              </button>
            )}
          </div>
        )}

        {completed && (
          <div className="mb-5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-md px-4 py-3 flex items-center gap-2 text-sm font-semibold">
            <Check size={18} aria-hidden="true" />
            Prova acquisita. Le correzioni saranno usate nei prossimi documenti.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(340px,0.82fr)_minmax(540px,1.18fr)] gap-5 items-start">
          <section className="bg-white border border-gray-300 rounded-md overflow-hidden lg:sticky lg:top-4">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
              <h2 className="font-heading text-base font-bold text-gray-900 uppercase">Documento</h2>
              {file && (
                <span className="text-xs text-gray-500 truncate max-w-[190px]">
                  {file.name}
                </span>
              )}
            </div>

            <div className="p-4">
              <div className="aspect-[4/3] bg-gray-100 border border-dashed border-gray-400 rounded-md overflow-hidden flex items-center justify-center">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Documento acquisito"
                    className="w-full h-full object-contain bg-gray-950"
                  />
                ) : (
                  <div className="text-center px-6">
                    <FileImage size={38} className="mx-auto text-gray-400" aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold text-gray-700">
                      Nessun documento acquisito
                    </p>
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
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-black text-white px-4 py-3 rounded-md font-bold text-sm disabled:opacity-40"
                >
                  <Camera size={18} aria-hidden="true" />
                  Fotocamera
                </button>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 bg-white hover:bg-gray-50 border border-gray-400 text-gray-800 px-4 py-3 rounded-md font-bold text-sm disabled:opacity-40"
                >
                  <Upload size={18} aria-hidden="true" />
                  Carica foto
                </button>
              </div>
              {scan?.warnings?.length > 0 && (
                <div className="mt-4 border-t border-gray-200 pt-3 space-y-1.5">
                  {scan.warnings.map(warning => (
                    <div key={warning} className="text-xs text-amber-900 flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="bg-white border border-gray-300 rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-gray-900 uppercase">
                Dati riconosciuti
              </h2>
              {scan?.ocr_confidence !== null && scan?.ocr_confidence !== undefined && (
                <span className={`text-xs font-bold border px-2 py-1 rounded-sm ${confidenceStyle(scan.ocr_confidence)}`}>
                  OCR {Math.round(scan.ocr_confidence)}%
                </span>
              )}
            </div>

            <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-2">
                  Tipo documento
                </span>
                <select
                  value={document.type}
                  disabled={!scan || busy}
                  onChange={event => updateDocument('type', event.target.value)}
                  className="input-touch w-full disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="ddt">DDT</option>
                  <option value="invoice">Fattura</option>
                  <option value="credit_note">Nota di credito</option>
                </select>
              </label>
              <label className="block">
                <span className="flex items-center justify-between gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <span>Fornitore</span>
                  {scan && (
                    <span className={`text-[11px] border px-1.5 py-0.5 rounded-sm ${confidenceStyle(document.supplierConfidence)}`}>
                      {document.supplierConfidence}%
                    </span>
                  )}
                </span>
                <select
                  value={document.supplierId}
                  disabled={!scan || busy}
                  onChange={event => updateSupplier(event.target.value)}
                  className="input-touch w-full disabled:bg-gray-100"
                >
                  <option value="">Non riconosciuto</option>
                  {catalog.suppliers.map(supplier => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-2">
                  Numero documento
                </span>
                <input
                  type="text"
                  value={document.number}
                  disabled={!scan || busy}
                  onChange={event => updateDocument('number', event.target.value)}
                  className="input-touch w-full disabled:bg-gray-100"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-2">Data</span>
                <input
                  type="date"
                  value={document.date}
                  disabled={!scan || busy}
                  onChange={event => updateDocument('date', event.target.value)}
                  className="input-touch w-full disabled:bg-gray-100"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="block text-sm font-semibold text-gray-700 mb-2">
                  Totale documento
                </span>
                <div className="relative max-w-xs">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={document.total}
                    disabled={!scan || busy}
                    onChange={event => updateDocument('total', event.target.value)}
                    className="input-touch w-full pr-10 disabled:bg-gray-100"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">
                    EUR
                  </span>
                </div>
              </label>
            </div>
          </section>
        </div>

        <section className="mt-5 bg-white border border-gray-300 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-heading text-base font-bold text-gray-900 uppercase">
                Righe documento
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">{rows.length} righe</p>
            </div>
            <button
              type="button"
              onClick={addRow}
              disabled={!scan || busy}
              className="inline-flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-2 rounded-md text-sm font-bold disabled:opacity-40"
            >
              <Plus size={17} aria-hidden="true" />
              Aggiungi riga
            </button>
          </div>

          <div className="divide-y divide-gray-200">
            {rows.map((row, index) => (
              <div
                key={row.id}
                className="p-4 grid grid-cols-1 xl:grid-cols-[42px_minmax(250px,1.4fr)_110px_130px_130px_42px] gap-3 items-end"
              >
                <div className="hidden xl:flex h-[52px] items-center justify-center text-sm font-bold text-gray-500">
                  {index + 1}
                </div>
                <label className="block min-w-0">
                  <span className="flex items-center justify-between gap-2 text-xs font-semibold text-gray-600 mb-1.5">
                    <span>Prodotto</span>
                    {scan && (
                      <span className={`border px-1.5 py-0.5 rounded-sm ${confidenceStyle(row.productConfidence)}`}>
                        {row.productConfidence}%
                      </span>
                    )}
                  </span>
                  <select
                    value={row.productId}
                    disabled={!scan || busy}
                    onChange={event => updateRowProduct(row.id, event.target.value)}
                    className="input-touch w-full disabled:bg-gray-100"
                  >
                    <option value="">Non associato</option>
                    {catalog.products.map(product => (
                      <option key={product.id} value={product.id}>
                        {product.name}{product.supplier ? ` · ${product.supplier}` : ''}
                      </option>
                    ))}
                  </select>
                  {row.sourceText && (
                    <p className="text-[11px] leading-4 text-gray-500 mt-1.5 break-words">
                      {row.sourceText}
                    </p>
                  )}
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Quantità
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.quantity}
                    disabled={!scan || busy}
                    onChange={event => updateRow(row.id, 'quantity', event.target.value)}
                    className="input-touch w-full disabled:bg-gray-100"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Prezzo unitario
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.unitPrice}
                    disabled={!scan || busy}
                    onChange={event => updateRow(row.id, 'unitPrice', event.target.value)}
                    className="input-touch w-full disabled:bg-gray-100"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Totale riga
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.lineTotal}
                    disabled={!scan || busy}
                    onChange={event => updateRow(row.id, 'lineTotal', event.target.value)}
                    className="input-touch w-full disabled:bg-gray-100"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={!scan || busy}
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
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-3 rounded-md font-bold text-sm disabled:opacity-40"
          >
            <RotateCcw size={18} aria-hidden="true" />
            Azzera prova
          </button>
          <button
            type="button"
            disabled={!canComplete}
            onClick={saveFeedback}
            className="inline-flex items-center justify-center gap-2 bg-[#F5C518] hover:bg-[#E5B418] border border-yellow-600 text-gray-950 px-5 py-3 rounded-md font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {phase === 'saving' ? (
              <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={18} aria-hidden="true" />
            )}
            Conferma prova
          </button>
        </div>
      </main>
    </div>
  );
};

export default ScannerDocumentiLabPage;
