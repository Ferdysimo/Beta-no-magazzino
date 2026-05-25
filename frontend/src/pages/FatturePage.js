import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import ZoomableImage from '../components/ZoomableImage';
import axios from 'axios';
import { Upload, Check, Trash2, Eye, X, FileText, Edit2, Plus, Settings } from 'lucide-react';
import PhotoLightbox from '../components/PhotoLightbox';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Resolve image source: old base64 or new file URL
const resolveImageSrc = (imageData) => {
  if (!imageData) return '';
  if (imageData.startsWith('data:')) return imageData; // legacy base64
  return `${BACKEND_URL}${imageData}`; // new file path: /api/uploads/filename.jpg
};

const FatturePage = () => {
  const { restaurant, token } = useAuth();
  const fileInputRef = useRef(null);
  
  // Form state
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [invoiceDate, setInvoiceDate] = useState('');
  const [supplier, setSupplier] = useState('');
  const [paid, setPaid] = useState(false);
  const [controlCode, setControlCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // List state
  const [invoices, setInvoices] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filterDate, setFilterDate] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('all');
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  const lightboxPhotos = useMemo(() => (
    (invoices || [])
      .filter(i => i.image_data)
      .map(i => ({
        url: i.image_data,
        label: `${i.supplier || 'Fornitore'}${i.control_code ? ' · ' + i.control_code : ''}`
      }))
  ), [invoices]);

  const openLightboxFor = (url) => {
    const idx = lightboxPhotos.findIndex((p) => p.url === url);
    if (idx >= 0) setLightboxIndex(idx);
  };
  
  // Supplier management modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [supplierError, setSupplierError] = useState('');

  // Set current date/time on load
  useEffect(() => {
    const now = new Date();
    const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setInvoiceDate(localDateTime);
  }, []);

  // Fetch invoices and suppliers
  const fetchInvoices = async () => {
    if (!token) return;
    try {
      let url = `${API}/invoices?`;
      if (filterDate) url += `date=${filterDate}T00:00:00&`;
      if (filterSupplier !== 'all') url += `supplier=${filterSupplier}`;
      
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setInvoices(response.data);
    } catch (err) {
      console.error('Error fetching invoices:', err);
    }
  };

  const fetchSuppliers = async () => {
    if (!token) return;
    try {
      const response = await axios.get(`${API}/suppliers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuppliers(response.data);
    } catch (err) {
      console.error('Error fetching suppliers:', err);
    }
  };

  useEffect(() => {
    fetchInvoices();
    fetchSuppliers();
  }, [token, filterDate, filterSupplier]);

  // Handle file selection
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 16 * 1024 * 1024) {
      setError('File troppo grande. Massimo 16 MB.');
      return;
    }
    
    setSelectedFile(file);
    setError('');
    
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Handle form submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!selectedFile) {
      setError('Seleziona una foto della fattura');
      return;
    }
    if (!supplier) {
      setError('Seleziona un fornitore');
      return;
    }
    if (!controlCode.trim()) {
      setError('Inserisci il codice di controllo');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          await axios.post(`${API}/invoices`, {
            supplier,
            paid,
            control_code: controlCode.trim(),
            image_data: reader.result,
            invoice_date: new Date(invoiceDate).toISOString()
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          
          // Reset form
          setSelectedFile(null);
          setPreview(null);
          setSupplier('');
          setPaid(false);
          setControlCode('');
          const now = new Date();
          setInvoiceDate(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
          setSuccess('Fattura caricata con successo!');
          setTimeout(() => setSuccess(''), 3000);
          
          fetchInvoices();
        } catch (err) {
          setError(err.response?.data?.detail || 'Errore nel caricamento');
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(selectedFile);
    } catch (err) {
      setError('Errore nella lettura del file');
      setLoading(false);
    }
  };

  // Supplier management
  const addSupplier = async () => {
    if (!newSupplierName.trim()) {
      setSupplierError('Inserisci un nome');
      return;
    }
    
    try {
      await axios.post(`${API}/suppliers?name=${encodeURIComponent(newSupplierName.trim())}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNewSupplierName('');
      setSupplierError('');
      fetchSuppliers();
    } catch (err) {
      setSupplierError(err.response?.data?.detail || 'Errore');
    }
  };

  const updateSupplier = async (supplierId, newName) => {
    try {
      await axios.patch(`${API}/suppliers/${supplierId}?name=${encodeURIComponent(newName)}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setEditingSupplier(null);
      fetchSuppliers();
    } catch (err) {
      setSupplierError(err.response?.data?.detail || 'Errore');
    }
  };

  const deleteSupplier = async (supplierId) => {
    if (!window.confirm('Eliminare questo fornitore?')) return;
    
    try {
      await axios.delete(`${API}/suppliers/${supplierId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchSuppliers();
    } catch (err) {
      setSupplierError(err.response?.data?.detail || 'Errore');
    }
  };

  // Toggle paid status
  const togglePaid = async (invoice) => {
    try {
      await axios.patch(`${API}/invoices/${invoice.id}?paid=${!invoice.paid}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchInvoices();
    } catch (err) {
      console.error('Error updating invoice:', err);
    }
  };

  // Delete invoice
  const deleteInvoice = async (invoiceId) => {
    if (!window.confirm('Sei sicuro di voler eliminare questa fattura?')) return;
    
    try {
      await axios.delete(`${API}/invoices/${invoiceId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchInvoices();
    } catch (err) {
      console.error('Error deleting invoice:', err);
    }
  };

  // Format date
  const formatDate = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Generate last 30 days for filter
  const generateDateOptions = () => {
    const options = [{ value: '', label: 'Tutti i giorni' }];
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      options.push({
        value: fmt.format(date),
        label: date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
      });
    }
    return options;
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      
      <main className="max-w-4xl mx-auto p-6">
        {/* Page Header */}
        <h1 className="font-heading text-3xl font-bold text-gray-900 mb-6">
          Elenco fatture {restaurant?.location}
        </h1>

        {/* Upload Form */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* File Upload */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Foto Fattura</label>
              <div className="flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="file-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  data-testid="select-file-btn"
                >
                  Scegli file
                </button>
                <span className="ml-3 text-gray-600">
                  {selectedFile ? selectedFile.name : 'Nessun file selezionato'}
                </span>
                <span className="ml-3 text-gray-400 text-sm">peso massimo 16 Mb</span>
              </div>
            </div>

            {/* Preview */}
            {preview && (
              <div className="flex items-start gap-4">
                <div className="w-32"></div>
                <div className="relative">
                  <img src={preview} alt="Preview" className="w-40 h-40 object-cover rounded-md border" />
                  <button
                    type="button"
                    onClick={() => { setSelectedFile(null); setPreview(null); }}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Date */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Data</label>
              <input
                type="datetime-local"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
                data-testid="date-input"
              />
            </div>

            {/* Supplier with management button */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Fornitore</label>
              <select
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="flex-1 max-w-xs h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none bg-white"
                data-testid="supplier-select"
              >
                <option value="">-- Seleziona fornitore --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowSupplierModal(true)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
                data-testid="manage-suppliers-btn"
              >
                <Settings size={16} />
                Gestisci fornitori
              </button>
            </div>

            {/* Paid Checkbox */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Stato</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={paid}
                  onChange={(e) => setPaid(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  data-testid="paid-checkbox"
                />
                <span className={`font-medium ${paid ? 'text-green-600' : 'text-gray-600'}`}>
                  Pagato
                </span>
              </label>
            </div>

            {/* Tipologia (fixed) */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Tipologia</label>
              <select
                className="h-10 px-3 border border-gray-300 rounded-md bg-gray-100"
                disabled
              >
                <option>Fatture</option>
              </select>
            </div>

            {/* Control Code */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Codice di controllo</label>
              <input
                type="text"
                value={controlCode}
                onChange={(e) => setControlCode(e.target.value)}
                className="flex-1 max-w-xs h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
                placeholder="Codice univoco"
                data-testid="control-code-input"
              />
            </div>

            {/* Error/Success Messages */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-md">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-md">
                {success}
              </div>
            )}

            {/* Submit Button */}
            <div className="bg-gray-50 -mx-6 -mb-6 mt-6 px-6 py-4 rounded-b-lg">
              <button
                type="submit"
                disabled={loading}
                className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-md font-medium transition-colors disabled:opacity-50"
                data-testid="upload-btn"
              >
                {loading ? 'Caricamento...' : 'Carica fattura'}
              </button>
            </div>
          </form>
        </div>

        {/* Divider */}
        <hr className="border-gray-300 mb-8" />

        {/* Invoices List */}
        <div>
          <h2 className="font-heading text-2xl font-bold text-gray-900 mb-4">Elenco fatture</h2>
          
          {/* Filters */}
          <div className="flex items-center gap-4 mb-4">
            <span className="text-gray-600">Filtra per:</span>
            <select
              value={filterSupplier}
              onChange={(e) => setFilterSupplier(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-md bg-white focus:border-blue-500 focus:outline-none"
              data-testid="filter-supplier"
            >
              <option value="all">Tutti i fornitori</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
            <select
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-md bg-white focus:border-blue-500 focus:outline-none"
              data-testid="filter-date"
            >
              {generateDateOptions().map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Invoice Cards */}
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <div
                key={invoice.id}
                className={`bg-white rounded-lg border-2 p-4 flex items-center gap-4 ${
                  invoice.paid ? 'border-green-300 bg-green-50' : 'border-gray-200'
                }`}
                data-testid={`invoice-${invoice.control_code}`}
              >
                {/* Thumbnail */}
                <div 
                  className="w-16 h-16 bg-gray-100 rounded-md flex items-center justify-center cursor-pointer overflow-hidden"
                  onClick={() => openLightboxFor(invoice.image_data)}
                >
                  {invoice.image_data ? (
                    <ZoomableImage src={resolveImageSrc(invoice.image_data)} alt="Fattura" className="w-full h-full object-cover" />
                  ) : (
                    <FileText className="text-gray-400" size={24} />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-800">{invoice.supplier}</span>
                    {invoice.paid && (
                      <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">
                        PAGATO
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600">
                    Codice: <strong>{invoice.control_code}</strong>
                  </div>
                  <div className="text-sm text-gray-500">
                    Data fattura: {formatDate(invoice.invoice_date)}
                  </div>
                  <div className="text-xs text-gray-400">
                    Caricata: {formatDate(invoice.created_at)}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openLightboxFor(invoice.image_data)}
                    className="w-10 h-10 flex items-center justify-center bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                    title="Visualizza"
                  >
                    <Eye size={18} />
                  </button>
                  <button
                    onClick={() => togglePaid(invoice)}
                    className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
                      invoice.paid 
                        ? 'bg-gray-400 hover:bg-gray-500 text-white' 
                        : 'bg-green-500 hover:bg-green-600 text-white'
                    }`}
                    title={invoice.paid ? 'Segna non pagato' : 'Segna pagato'}
                  >
                    <Check size={18} />
                  </button>
                  <button
                    onClick={() => deleteInvoice(invoice.id)}
                    className="w-10 h-10 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                    title="Elimina"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}

            {invoices.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                Nessuna fattura trovata
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Supplier Management Modal */}
      {showSupplierModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowSupplierModal(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-bold text-lg">Gestisci Fornitori</h3>
              <button
                onClick={() => setShowSupplierModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="p-4">
              {/* Add new supplier */}
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder="Nuovo fornitore..."
                  className="flex-1 h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && addSupplier()}
                />
                <button
                  onClick={addSupplier}
                  className="px-4 h-10 bg-green-500 hover:bg-green-600 text-white rounded-md flex items-center gap-1"
                >
                  <Plus size={18} />
                  Aggiungi
                </button>
              </div>

              {supplierError && (
                <div className="text-red-600 text-sm mb-3">{supplierError}</div>
              )}

              {/* Supplier list */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {suppliers.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                    {editingSupplier === s.id ? (
                      <input
                        type="text"
                        defaultValue={s.name}
                        className="flex-1 h-8 px-2 border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                        onBlur={(e) => updateSupplier(s.id, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && updateSupplier(s.id, e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <span className="flex-1 font-medium">{s.name}</span>
                    )}
                    <button
                      onClick={() => setEditingSupplier(s.id)}
                      className="w-8 h-8 flex items-center justify-center text-amber-600 hover:bg-amber-100 rounded"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => deleteSupplier(s.id)}
                      className="w-8 h-8 flex items-center justify-center text-red-600 hover:bg-red-100 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                
                {suppliers.length === 0 && (
                  <div className="text-center text-gray-500 py-4">
                    Nessun fornitore. Aggiungine uno!
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setShowSupplierModal(false)}
                className="w-full py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-md font-medium"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Viewer Lightbox with navigation */}
      <PhotoLightbox
        photos={lightboxPhotos}
        index={lightboxIndex}
        onChangeIndex={setLightboxIndex}
        onClose={() => setLightboxIndex(-1)}
        resolve={resolveImageSrc}
      />
    </div>
  );
};

export default FatturePage;
