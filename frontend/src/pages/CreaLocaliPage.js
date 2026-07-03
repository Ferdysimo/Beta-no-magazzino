import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CreaLocaliPage = () => {
  const { token, restaurant } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: '',
    location: '',
    password: '',
    boiler_count: 1
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  const canAccess = restaurant?.username === 'Simone' && restaurant?.role === 'admin';

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
    setCreated(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setCreated(null);

    try {
      const payload = {
        username: form.username.trim(),
        location: form.location.trim(),
        password: form.password,
        boiler_count: Number(form.boiler_count)
      };
      const res = await axios.post(`${API}/admin/locali`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCreated(res.data);
      setForm({ username: '', location: '', password: '', boiler_count: 1 });
    } catch (err) {
      setError(err.response?.data?.detail || 'Errore durante la creazione del locale');
    } finally {
      setSaving(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <div className="bg-white border border-red-200 rounded-lg p-6 text-red-700">
            Accesso riservato.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-3xl mx-auto p-6">
        <div className="bg-[#ECECEC] border border-gray-300 rounded-lg p-8">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="font-heading text-3xl font-bold text-gray-800 uppercase">
                Crea nuovi locali
              </h1>
              <p className="text-gray-600">Nuovo locale ristorante</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/home')}
              className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-md font-medium transition-colors"
            >
              Indietro
            </button>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          {created && (
            <div className="mb-4 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md text-sm">
              Locale creato: <b>{created.location}</b> ({created.username})
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nome utente
              </label>
              <input
                data-testid="new-local-username"
                type="text"
                value={form.username}
                onChange={(e) => updateField('username', e.target.value)}
                className="input-touch w-full"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nome del locale
              </label>
              <input
                data-testid="new-local-location"
                type="text"
                value={form.location}
                onChange={(e) => updateField('location', e.target.value)}
                className="input-touch w-full"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                data-testid="new-local-password"
                type="text"
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
                className="input-touch w-full"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Bollitori
              </label>
              <select
                data-testid="new-local-boiler-count"
                value={form.boiler_count}
                onChange={(e) => updateField('boiler_count', e.target.value)}
                className="input-touch w-full"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>

            <button
              data-testid="new-local-submit"
              type="submit"
              disabled={saving}
              className="action-button w-full"
            >
              {saving ? 'Creazione...' : 'Crea locale'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default CreaLocaliPage;
