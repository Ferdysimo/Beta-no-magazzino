import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import ZoomableImage from '../components/ZoomableImage';
import axios from 'axios';
import { X, FileText, Trash2, Eye, Search } from 'lucide-react';
import { compressImage, friendlyUploadError } from '../utils/compressImage';
import PhotoLightbox from '../components/PhotoLightbox';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const resolveImageSrc = (imageData) => {
  if (!imageData) return '';
  if (imageData.startsWith('data:')) return imageData;
  return `${BACKEND_URL}${imageData}`;
};

const VersamentiPage = () => {
  const { restaurant, token } = useAuth();
  const fileInputRef = useRef(null);
  
  // Form state
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [versamentoDate, setVersamentoDate] = useState('');
  const [description, setDescription] = useState('');
  const [controlCode, setControlCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [compressing, setCompressing] = useState(false);
  const [compressedData, setCompressedData] = useState(null); // base64 ready to POST
  
  // List state
  const [versamenti, setVersamenti] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  const lightboxPhotos = useMemo(() => (
    (versamenti || [])
      .filter(v => v.image_data)
      .map(v => ({
        url: v.image_data,
        label: `${v.description || 'Versamento'}${v.control_code ? ' · ' + v.control_code : ''}`
      }))
  ), [versamenti]);

  const openLightboxFor = (url) => {
    const i = lightboxPhotos.findIndex((p) => p.url === url);
    if (i >= 0) setLightboxIndex(i);
  };

  // Set current date/time on load
  useEffect(() => {
    const now = new Date();
    const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setVersamentoDate(localDateTime);
  }, []);

  // Fetch versamenti
  const fetchVersamenti = async () => {
    if (!token) return;
    try {
      let url = `${API}/versamenti`;
      if (searchTerm) url += `?search=${encodeURIComponent(searchTerm)}`;
      
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setVersamenti(response.data);
    } catch (err) {
      console.error('Error fetching versamenti:', err);
    }
  };

  useEffect(() => {
    fetchVersamenti();
  }, [token, searchTerm]);

  // Handle file selection
  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 30 * 1024 * 1024) {
      setError('File troppo grande. Massimo 30 MB.');
      return;
    }

    setSelectedFile(file);
    setError('');
    setCompressing(true);
    try {
      const { dataUrl } = await compressImage(file);
      setPreview(dataUrl);
      setCompressedData(dataUrl);
    } catch (err) {
      setError('Errore elaborazione foto: ' + (err.message || 'riprova'));
      setSelectedFile(null);
      setPreview(null);
      setCompressedData(null);
    } finally {
      setCompressing(false);
    }
  };

  // Handle form submit
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedFile || !compressedData) {
      setError('Seleziona un file per il versamento');
      return;
    }

    setLoading(true);
    setError('');
    setUploadProgress(0);

    try {
      await axios.post(`${API}/versamenti`, {
        description,
        control_code: controlCode,
        image_data: compressedData,
        versamento_date: new Date(versamentoDate).toISOString()
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 120000,
        onUploadProgress: (evt) => {
          if (evt.total) setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });

      // Reset form
      setSelectedFile(null);
      setPreview(null);
      setCompressedData(null);
      setDescription('');
      setControlCode('');
      const now = new Date();
      setVersamentoDate(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
      setSuccess('Versamento caricato con successo!');
      setTimeout(() => setSuccess(''), 3000);

      fetchVersamenti();
    } catch (err) {
      setError(friendlyUploadError(err));
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  // Delete versamento
  const deleteVersamento = async (versamentoId) => {
    if (!window.confirm('Sei sicuro di voler eliminare questo versamento?')) return;
    
    try {
      await axios.delete(`${API}/versamenti/${versamentoId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchVersamenti();
    } catch (err) {
      console.error('Error deleting versamento:', err);
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
          Elenco versamenti {restaurant?.location}
        </h1>

        {/* Upload Form */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* File Upload */}
            <div className="flex items-center gap-4">
              <label className="w-32 text-gray-700 font-medium">Versamento</label>
              <div className="flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="versamento-file-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  data-testid="versamento-select-file-btn"
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
                value={versamentoDate}
                onChange={(e) => setVersamentoDate(e.target.value)}
                className="h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
                data-testid="versamento-date-input"
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
                placeholder="Descrizione versamento"
                data-testid="versamento-description-input"
              />
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
                data-testid="versamento-control-code-input"
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
                disabled={loading || compressing}
                className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-md font-medium transition-colors disabled:opacity-50"
                data-testid="versamento-upload-btn"
              >
                {compressing
                  ? 'Elaboro foto...'
                  : loading
                    ? (uploadProgress > 0 && uploadProgress < 100 ? `Caricamento... ${uploadProgress}%` : 'Caricamento...')
                    : 'Carica versamento'}
              </button>
            </div>
          </form>
        </div>

        {/* Divider */}
        <hr className="border-gray-300 mb-8" />

        {/* Versamenti List */}
        <div>
          <h2 className="font-heading text-2xl font-bold text-gray-900 mb-4">Elenco versamenti</h2>
          
          {/* Search */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cerca..."
                className="h-10 pl-10 pr-4 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none w-64"
                data-testid="versamento-search-input"
              />
            </div>
          </div>

          {/* Versamenti Cards */}
          <div className="space-y-3">
            {versamenti.map((versamento) => (
              <div
                key={versamento.id}
                className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors"
                data-testid={`versamento-${versamento.id}`}
              >
                {/* Thumbnail */}
                <div 
                  className="w-14 h-14 bg-gray-100 rounded-md flex items-center justify-center cursor-pointer overflow-hidden flex-shrink-0"
                  onClick={() => openLightboxFor(versamento.image_data)}
                >
                  {versamento.image_data ? (
                    <ZoomableImage src={resolveImageSrc(versamento.image_data)} alt="Versamento" className="w-full h-full object-cover" />
                  ) : (
                    <FileText className="text-gray-400" size={24} />
                  )}
                </div>

                {/* Description */}
                <div className="flex-1">
                  <span className="text-gray-800 font-medium">
                    {versamento.description || <span className="text-gray-400 italic">Nessuna descrizione</span>}
                  </span>
                  {versamento.control_code && (
                    <div className="text-xs text-gray-500">
                      Codice: {versamento.control_code}
                    </div>
                  )}
                </div>

                {/* Date */}
                <div className="text-gray-600 text-sm">
                  {formatDateItalian(versamento.versamento_date)}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openLightboxFor(versamento.image_data)}
                    className="w-10 h-10 flex items-center justify-center bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                    title="Visualizza"
                  >
                    <Eye size={18} />
                  </button>
                  <button
                    onClick={() => deleteVersamento(versamento.id)}
                    className="w-10 h-10 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                    title="Elimina"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}

            {versamenti.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                Nessun versamento trovato
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Image Viewer Modal */}
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

export default VersamentiPage;
