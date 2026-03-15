import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import axios from 'axios';
import { Upload, Check, Trash2, Eye, X, FileText } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const FatturePage = () => {
  const { restaurant, token } = useAuth();
  const fileInputRef = useRef(null);
  
  // Form state
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
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
  const [viewingInvoice, setViewingInvoice] = useState(null);

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
    
    // Check file size (16 MB max)
    if (file.size > 16 * 1024 * 1024) {
      setError('File troppo grande. Massimo 16 MB.');
      return;
    }
    
    setSelectedFile(file);
    setError('');
    
    // Create preview
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
    if (!supplier.trim()) {
      setError('Inserisci il fornitore');
      return;
    }
    if (!controlCode.trim()) {
      setError('Inserisci il codice di controllo');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          await axios.post(`${API}/invoices`, {
            supplier: supplier.trim(),
            paid,
            control_code: controlCode.trim(),
            image_data: reader.result
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          
          // Reset form
          setSelectedFile(null);
          setPreview(null);
          setSupplier('');
          setPaid(false);
          setControlCode('');
          setSuccess('Fattura caricata con successo!');
          setTimeout(() => setSuccess(''), 3000);
          
          // Refresh lists
          fetchInvoices();
          fetchSuppliers();
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
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      options.push({
        value: date.toISOString().split('T')[0],
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

            {/* Supplier */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Fornitore</label>
              <input
                type="text"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="flex-1 max-w-xs h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
                placeholder="Nome fornitore"
                list="suppliers-list"
                data-testid="supplier-input"
              />
              <datalist id="suppliers-list">
                {suppliers.map((s, i) => (
                  <option key={i} value={s} />
                ))}
              </datalist>
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
              {suppliers.map((s, i) => (
                <option key={i} value={s}>{s}</option>
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
                  onClick={() => setViewingInvoice(invoice)}
                >
                  {invoice.image_data ? (
                    <img src={invoice.image_data} alt="Fattura" className="w-full h-full object-cover" />
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
                    {formatDate(invoice.created_at)}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewingInvoice(invoice)}
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

      {/* Image Viewer Modal */}
      {viewingInvoice && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setViewingInvoice(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setViewingInvoice(null)}
              className="absolute -top-4 -right-4 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg"
            >
              <X size={24} />
            </button>
            <img 
              src={viewingInvoice.image_data} 
              alt="Fattura" 
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
            <div className="bg-white p-3 rounded-b-lg mt-1">
              <p><strong>Fornitore:</strong> {viewingInvoice.supplier}</p>
              <p><strong>Codice:</strong> {viewingInvoice.control_code}</p>
              <p><strong>Stato:</strong> {viewingInvoice.paid ? '✅ Pagato' : '⏳ Non pagato'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FatturePage;
