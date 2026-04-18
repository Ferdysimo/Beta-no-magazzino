import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { APP_VERSION } from '../components/Header';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      navigate('/home');
    } catch (err) {
      setError(err.response?.data?.detail || 'Credenziali non valide');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center bg-cover bg-center relative"
      style={{
        backgroundImage: `url('https://images.unsplash.com/photo-1612966874574-e0a92ad2bc43?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1Nzl8MHwxfHNlYXJjaHwxfHxhdXRoZW50aWMlMjBpdGFsaWFuJTIwcGFzdGElMjBwbGF0ZSUyMGZyZXNofGVufDB8fHx8MTc3MzQwMTgyNXww&ixlib=rb-4.1.0&q=85')`
      }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" />
      
      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="bg-white rounded-xl shadow-2xl p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-4">
              <img src="/logo-icon.png" alt="Pastasciutta Roma" className="h-20 object-contain" />
            </div>
            <h1 className="font-heading text-4xl font-bold tracking-tight text-gray-900 uppercase">
              — Pastasciutta —
            </h1>
            <p className="font-heading text-xl tracking-[0.3em] text-gray-600 uppercase mt-1">
              Roma
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div 
                data-testid="login-error"
                className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm"
              >
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Utente
              </label>
              <input
                data-testid="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-touch w-full"
                placeholder="Nome utente"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  data-testid="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-touch w-full pr-12"
                  placeholder="Password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button
              data-testid="login-submit"
              type="submit"
              disabled={loading}
              className="action-button w-full flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Accesso...
                </>
              ) : (
                'Accedi'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-white/60 text-sm mt-6">
          © 2026 Pastasciutta Srl — v{APP_VERSION}
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
