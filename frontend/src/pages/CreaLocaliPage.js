import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  FileSpreadsheet,
  MapPin,
  Monitor,
  Save,
  Settings2,
  Store,
} from 'lucide-react';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const emptyForm = () => ({
  username: '',
  location: '',
  password: '',
  report_code: '',
  boiler_count: 1,
  address: '',
  postal_code: '',
  city: 'Roma',
  monitor_customers_enabled: false,
});

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-sm font-semibold text-gray-700 mb-2">{label}</span>
    {children}
  </label>
);

const SectionTitle = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-2 mb-5">
    <Icon size={19} className="text-gray-600" aria-hidden="true" />
    <h2 className="font-heading text-lg font-bold text-gray-900 uppercase">{children}</h2>
  </div>
);

const CreaLocaliPage = () => {
  const { token, restaurant } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  const canAccess = restaurant?.username === 'Simone' && restaurant?.role === 'admin';

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
    setCreated(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setCreated(null);

    try {
      const payload = {
        username: form.username.trim(),
        location: form.location.trim(),
        password: form.password,
        report_code: form.report_code.trim().toUpperCase(),
        boiler_count: Number(form.boiler_count),
        address: form.address.trim(),
        postal_code: form.postal_code.trim(),
        city: form.city.trim(),
        monitor_customers_enabled: form.monitor_customers_enabled,
      };
      const res = await axios.post(`${API}/admin/locali`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCreated(res.data);
      setForm(emptyForm());
      setShowPassword(false);
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
          <div className="bg-white border border-red-200 rounded-md p-6 text-red-700">
            Accesso riservato.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-5xl mx-auto p-3 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase">
              Crea nuovo locale
            </h1>
            <p className="text-sm text-gray-500 mt-1">Configurazione completa del locale</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-2 rounded-md font-semibold text-sm"
          >
            <ArrowLeft size={17} aria-hidden="true" />
            Indietro
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
            {error}
          </div>
        )}

        {created && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-900 px-4 py-3 rounded-md text-sm">
            Locale creato: <b>{created.location}</b>, username <b>{created.username}</b>, sigla Excel <b>{created.report_code}</b>.
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white border border-gray-300 rounded-md overflow-hidden shadow-sm">
          <section className="p-5 sm:p-6 border-b border-gray-200">
            <SectionTitle icon={Store}>Identita e accesso</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Nome del locale">
                <input
                  data-testid="new-local-location"
                  type="text"
                  value={form.location}
                  onChange={(e) => updateField('location', e.target.value)}
                  className="input-touch w-full"
                  maxLength={80}
                  autoComplete="organization"
                  required
                />
              </Field>
              <Field label="Nome utente">
                <input
                  data-testid="new-local-username"
                  type="text"
                  value={form.username}
                  onChange={(e) => updateField('username', e.target.value)}
                  className="input-touch w-full"
                  maxLength={50}
                  autoComplete="username"
                  required
                />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <input
                    data-testid="new-local-password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => updateField('password', e.target.value)}
                    className="input-touch w-full pr-12"
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(value => !value)}
                    className="absolute inset-y-0 right-0 w-11 flex items-center justify-center text-gray-500 hover:text-gray-900"
                    title={showPassword ? 'Nascondi password' : 'Mostra password'}
                    aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                  >
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </Field>
              <Field label="Sigla Excel">
                <div className="relative">
                  <FileSpreadsheet size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                  <input
                    data-testid="new-local-report-code"
                    type="text"
                    value={form.report_code}
                    onChange={(e) => updateField('report_code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
                    className="input-touch w-full pl-10 uppercase"
                    minLength={1}
                    maxLength={4}
                    pattern="[A-Za-z0-9]{1,4}"
                    required
                  />
                </div>
              </Field>
            </div>
          </section>

          <section className="p-5 sm:p-6 border-b border-gray-200">
            <SectionTitle icon={MapPin}>Consegna e DDT</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-5">
              <div className="sm:col-span-6">
                <Field label="Indirizzo">
                  <input
                    data-testid="new-local-address"
                    type="text"
                    value={form.address}
                    onChange={(e) => updateField('address', e.target.value)}
                    className="input-touch w-full"
                    maxLength={120}
                    autoComplete="street-address"
                    required
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="CAP">
                  <input
                    data-testid="new-local-postal-code"
                    type="text"
                    inputMode="numeric"
                    value={form.postal_code}
                    onChange={(e) => updateField('postal_code', e.target.value.replace(/\D/g, '').slice(0, 5))}
                    className="input-touch w-full"
                    minLength={5}
                    maxLength={5}
                    pattern="[0-9]{5}"
                    autoComplete="postal-code"
                    required
                  />
                </Field>
              </div>
              <div className="sm:col-span-4">
                <Field label="Citta">
                  <input
                    data-testid="new-local-city"
                    type="text"
                    value={form.city}
                    onChange={(e) => updateField('city', e.target.value)}
                    className="input-touch w-full"
                    maxLength={80}
                    autoComplete="address-level2"
                    required
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="p-5 sm:p-6 border-b border-gray-200">
            <SectionTitle icon={Settings2}>Operativita</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-end">
              <Field label="Numero bollitori">
                <select
                  data-testid="new-local-boiler-count"
                  value={form.boiler_count}
                  onChange={(e) => updateField('boiler_count', e.target.value)}
                  className="input-touch w-full"
                >
                  <option value={1}>1 bollitore</option>
                  <option value={2}>2 bollitori</option>
                </select>
              </Field>
              <label className="h-[52px] flex items-center gap-3 border border-gray-300 rounded-md px-4 bg-gray-50 cursor-pointer">
                <input
                  data-testid="new-local-monitor-enabled"
                  type="checkbox"
                  checked={form.monitor_customers_enabled}
                  onChange={(e) => updateField('monitor_customers_enabled', e.target.checked)}
                  className="h-5 w-5 accent-[#F5C518]"
                />
                <Monitor size={19} className="text-gray-600" aria-hidden="true" />
                <span className="font-semibold text-gray-800">Monitor clienti</span>
              </label>
            </div>
          </section>

          <div className="p-5 sm:p-6 flex justify-end bg-gray-50">
            <button
              data-testid="new-local-submit"
              type="submit"
              disabled={saving}
              className="action-button inline-flex items-center justify-center gap-2 min-w-[190px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Save size={18} aria-hidden="true" />
              {saving ? 'Creazione...' : 'Crea locale'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};

export default CreaLocaliPage;
