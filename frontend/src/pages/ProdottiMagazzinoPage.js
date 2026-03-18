import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { Edit2, Trash2, Plus, X, Upload, Search } from 'lucide-react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const resolveImageSrc = (url) => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `${BACKEND_URL}${url}`;
};

const ProdottiMagazzinoPage = () => {
  const { token } = useAuth();
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filterSupplier, setFilterSupplier] = useState('');
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formName, setFormName] = useState('');
  const [formUnit, setFormUnit] = useState('');
  const [formSupplier, setFormSupplier] = useState('');
  const [formImagePreview, setFormImagePreview] = useState('');
  const [formImageData, setFormImageData] = useState('');
  const [saving, setSaving] = useState(false);

  // New supplier
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');

  const fileInputRef = useRef(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchProducts = async () => {
    try {
      const params = filterSupplier ? { supplier: filterSupplier } : {};
      const res = await axios.get(`${API}/products`, { headers, params });
      setProducts(res.data);
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const res = await axios.get(`${API}/suppliers`, { headers });
      setSuppliers(res.data);
    } catch (err) {
      console.error('Error fetching suppliers:', err);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchSuppliers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchProducts();
  }, [filterSupplier]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setFormName('');
    setFormUnit('');
    setFormSupplier('');
    setFormImagePreview('');
    setFormImageData('');
    setEditingProduct(null);
    setShowForm(false);
    setShowNewSupplier(false);
    setNewSupplierName('');
  };

  const openEditForm = (product) => {
    setEditingProduct(product);
    setFormName(product.name);
    setFormUnit(product.unit || '');
    setFormSupplier(product.supplier || '');
    setFormImagePreview(product.image_url ? resolveImageSrc(product.image_url) : '');
    setFormImageData('');
    setShowForm(true);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setFormImagePreview(reader.result);
      setFormImageData(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleAddSupplier = async () => {
    if (!newSupplierName.trim()) return;
    try {
      await axios.post(`${API}/suppliers?name=${encodeURIComponent(newSupplierName.trim())}`, {}, { headers });
      await fetchSuppliers();
      setFormSupplier(newSupplierName.trim());
      setNewSupplierName('');
      setShowNewSupplier(false);
    } catch (err) {
      console.error('Error adding supplier:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setSaving(true);

    try {
      if (editingProduct) {
        const payload = {
          name: formName.trim(),
          unit: formUnit.trim(),
          supplier: formSupplier,
        };
        if (formImageData) payload.image_data = formImageData;
        await axios.put(`${API}/products/${editingProduct.id}`, payload, { headers });
      } else {
        const payload = {
          name: formName.trim(),
          unit: formUnit.trim(),
          supplier: formSupplier,
          image_data: formImageData,
        };
        await axios.post(`${API}/products`, payload, { headers });
      }
      resetForm();
      fetchProducts();
    } catch (err) {
      console.error('Error saving product:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (productId) => {
    if (!window.confirm('Eliminare questo prodotto?')) return;
    try {
      await axios.delete(`${API}/products/${productId}`, { headers });
      fetchProducts();
    } catch (err) {
      console.error('Error deleting product:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-4xl mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="font-heading text-3xl font-bold text-gray-900 uppercase">
            Prodotti magazzino
          </h1>
          <button
            data-testid="add-product-btn"
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <Plus size={18} /> Aggiungi prodotto
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">
                {editingProduct ? 'Modifica prodotto' : 'Nuovo prodotto'}
              </h2>
              <button onClick={resetForm} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                  <input
                    data-testid="product-name-input"
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Nome del prodotto"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Unità (cartoni, buste, ecc.)
                  </label>
                  <input
                    data-testid="product-unit-input"
                    type="text"
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="es: cartoni, buste, cestelli"
                  />
                </div>
              </div>

              {/* Foto */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Foto</label>
                <div className="flex items-center gap-4">
                  {formImagePreview && (
                    <img
                      src={formImagePreview}
                      alt="Preview"
                      className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 transition-colors"
                  >
                    <Upload size={16} /> {formImagePreview ? 'Cambia foto' : 'Carica foto'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <span className="text-xs text-gray-400">Max 16MB</span>
                </div>
              </div>

              {/* Fornitore */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fornitore</label>
                <div className="flex items-center gap-2">
                  <select
                    data-testid="product-supplier-select"
                    value={formSupplier}
                    onChange={(e) => setFormSupplier(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">— Seleziona fornitore —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowNewSupplier(!showNewSupplier)}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    + Nuovo fornitore
                  </button>
                </div>

                {showNewSupplier && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      data-testid="new-supplier-input"
                      type="text"
                      value={newSupplierName}
                      onChange={(e) => setNewSupplierName(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="Nome nuovo fornitore"
                    />
                    <button
                      type="button"
                      onClick={handleAddSupplier}
                      className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Aggiungi
                    </button>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  data-testid="product-save-btn"
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {saving ? 'Salvataggio...' : editingProduct ? 'Salva modifiche' : 'Aggiungi prodotto'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center gap-3 mb-4">
          <Search size={18} className="text-gray-400" />
          <select
            data-testid="filter-supplier-select"
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Tutti i fornitori</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
          <span className="text-sm text-gray-500">{products.length} prodotti</span>
        </div>

        {/* Product List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Caricamento...</div>
          ) : products.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              {filterSupplier ? 'Nessun prodotto per questo fornitore.' : 'Nessun prodotto in magazzino.'}
            </div>
          ) : (
            products.map((product) => (
              <div
                key={product.id}
                data-testid={`product-row-${product.id}`}
                className="flex items-center px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
              >
                {/* Image */}
                <div className="w-14 h-14 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 flex-shrink-0 mr-4">
                  {product.image_url ? (
                    <img
                      src={resolveImageSrc(product.image_url)}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">
                      No img
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {product.name}
                    {product.unit && (
                      <span className="text-gray-500 font-normal ml-1">({product.unit})</span>
                    )}
                  </p>
                </div>

                {/* Supplier column */}
                <div className="w-48 text-sm text-gray-600 truncate px-4">
                  {product.supplier || '—'}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-4">
                  <button
                    data-testid={`edit-product-${product.id}`}
                    onClick={() => openEditForm(product)}
                    className="w-9 h-9 flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    data-testid={`delete-product-${product.id}`}
                    onClick={() => handleDelete(product.id)}
                    className="w-9 h-9 flex items-center justify-center bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
};

export default ProdottiMagazzinoPage;
