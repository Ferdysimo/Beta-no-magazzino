import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import axios from 'axios';
import { X, FileText, Trash2, Eye, Search } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ChiusurePage = () => {
  const { restaurant, token } = useAuth();
  const fileInputRef = useRef(null);
  
  // Form state
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [chiusuraDate, setChiusuraDate] = useState('');
  const [description, setDescription] = useState('');
  const [tipologia, setTipologia] = useState('Piatti');
  const [controlCode, setControlCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // List state
  const [chiusure, setChiusure] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTipologia, setFilterTipologia] = useState('all');
  const [viewingChiusura, setViewingChiusura] = useState(null);

  // Set current date/time on load
  useEffect(() => {
    const now = new Date();
    const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setChiusuraDate(localDateTime);
  }, []);

  // Fetch chiusure
  const fetchChiusure = async () => {
    if (!token) return;
    try {
      let url = `${API}/chiusure?`;
      if (searchTerm) url += `search=${encodeURIComponent(searchTerm)}&`;
      if (filterTipologia !== 'all') url += `tipologia=${filterTipologia}`;
      
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setChiusure(response.data);
    } catch (err) {
      console.error('Error fetching chiusure:', err);
    }
  };

  useEffect(() => {
    fetchChiusure();
  }, [token, searchTerm, filterTipologia]);

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
      setError('Seleziona un file per la chiusura');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          await axios.post(`${API}/chiusure`, {
            description,
            tipologia,
            control_code: controlCode,
            image_data: reader.result,
            chiusura_date: new Date(chiusuraDate).toISOString()
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          
          // Reset form
          setSelectedFile(null);
          setPreview(null);
          setDescription('');
          setTipologia('Piatti');
          setControlCode('');
          const now = new Date();
          setChiusuraDate(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
          setSuccess('Chiusura caricata con successo!');
          setTimeout(() => setSuccess(''), 3000);
          
          fetchChiusure();
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

  // Delete chiusura
  const deleteChiusura = async (chiusuraId) => {
    if (!window.confirm('Sei sicuro di voler eliminare questa chiusura?')) return;
    
    try {
      await axios.delete(`${API}/chiusure/${chiusuraId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchChiusure();
    } catch (err) {
      console.error('Error deleting chiusura:', err);
    }
  };

  // Format date in Italian
  const formatDateItalian = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const months = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 
                    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    const day = date.getDate().toString().padStart(2, '0');
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day} ${month} ${year} alle ${hours}:${minutes}`;
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      
      <main className="max-w-4xl mx-auto p-6">
        {/* Page Header */}
        <h1 className="font-heading text-3xl font-bold text-gray-900 mb-6">
          Elenco chiusure {restaurant?.location}
        </h1>

        {/* Upload Form */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* File Upload */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Chiusura</label>
              <div className="flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="chiusura-file-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  data-testid="chiusura-select-file-btn"
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
                value={chiusuraDate}
                onChange={(e) => setChiusuraDate(e.target.value)}
                className="h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
                data-testid="chiusura-date-input"
              />
            </div>

            {/* Description */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Descrizione</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="flex-1 max-w-md h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
                placeholder="Descrizione chiusura"
                data-testid="chiusura-description-input"
              />
            </div>

            {/* Tipologia */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Tipologia</label>
              <select
                value={tipologia}
                onChange={(e) => setTipologia(e.target.value)}
                className="h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none bg-white"
                data-testid="chiusura-tipologia-select"
              >
                <option value="Piatti">Piatti</option>
                <option value="Report">Report</option>
              </select>
            </div>

            {/* Control Code */}
            <div className="flex items-start gap-4">
              <label className="w-32 text-gray-700 font-medium text-sm leading-tight">
                Codice di controllo<br/>
                <span className="text-gray-400 text-xs">(per evitare doppioni, inserire lettere o numeri)</span>
              </label>
              <input
                type="text"
                value={controlCode}
                onChange={(e) => setControlCode(e.target.value)}
                className="flex-1 max-w-xs h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
                data-testid="chiusura-control-code-input"
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
                data-testid="chiusura-upload-btn"
              >
                {loading ? 'Caricamento...' : 'Carica chiusura'}
              </button>
            </div>
          </form>
        </div>

        {/* Divider */}
        <hr className="border-gray-300 mb-8" />

        {/* Chiusure List */}
        <div>
          <h2 className="font-heading text-2xl font-bold text-gray-900 mb-4">Elenco chiusure</h2>
          
          {/* Search and Filters */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cerca..."
                className="h-10 pl-10 pr-4 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none w-48"
                data-testid="chiusura-search-input"
              />
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => setFilterTipologia('all')}
                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                  filterTipologia === 'all' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
                data-testid="filter-all"
              >
                Visualizza piatti e report
              </button>
              <button
                onClick={() => setFilterTipologia('Piatti')}
                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                  filterTipologia === 'Piatti' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
                data-testid="filter-piatti"
              >
                Visualizza solo i piatti
              </button>
              <button
                onClick={() => setFilterTipologia('Report')}
                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                  filterTipologia === 'Report' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
                data-testid="filter-report"
              >
                Visualizza solo i report
              </button>
            </div>
          </div>

          {/* Chiusure Cards */}
          <div className="space-y-3">
            {chiusure.map((chiusura) => (
              <div
                key={chiusura.id}
                className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors"
                data-testid={`chiusura-${chiusura.id}`}
              >
                {/* Thumbnail */}
                <div 
                  className="w-14 h-14 bg-gray-100 rounded-md flex items-center justify-center cursor-pointer overflow-hidden flex-shrink-0"
                  onClick={() => setViewingChiusura(chiusura)}
                >
                  {chiusura.image_data ? (
                    <img src={chiusura.image_data} alt="Chiusura" className="w-full h-full object-cover" />
                  ) : (
                    <FileText className="text-gray-400" size={24} />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1">
                  <span className="text-gray-600 text-sm">
                    {chiusura.tipologia.toLowerCase()}
                  </span>
                  {chiusura.description && (
                    <div className="text-gray-800 font-medium">
                      {chiusura.description}
                    </div>
                  )}
                  {chiusura.control_code && (
                    <div className="text-xs text-gray-500">
                      Codice: {chiusura.control_code}
                    </div>
                  )}
                </div>

                {/* Date */}
                <div className="text-gray-600 text-sm">
                  {formatDateItalian(chiusura.chiusura_date)}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewingChiusura(chiusura)}
                    className="w-10 h-10 flex items-center justify-center bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                    title="Visualizza"
                  >
                    <Eye size={18} />
                  </button>
                  <button
                    onClick={() => deleteChiusura(chiusura.id)}
                    className="w-10 h-10 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                    title="Elimina"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}

            {chiusure.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                Nessuna chiusura trovata
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Image Viewer Modal */}
      {viewingChiusura && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setViewingChiusura(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setViewingChiusura(null)}
              className="absolute -top-4 -right-4 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg"
            >
              <X size={24} />
            </button>
            <img 
              src={viewingChiusura.image_data} 
              alt="Chiusura" 
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
            <div className="bg-white p-3 rounded-b-lg mt-1">
              <p><strong>Tipologia:</strong> {viewingChiusura.tipologia}</p>
              {viewingChiusura.description && (
                <p><strong>Descrizione:</strong> {viewingChiusura.description}</p>
              )}
              {viewingChiusura.control_code && (
                <p><strong>Codice:</strong> {viewingChiusura.control_code}</p>
              )}
              <p><strong>Data:</strong> {formatDateItalian(viewingChiusura.chiusura_date)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChiusurePage;
