import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Header = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleHome = () => {
    navigate('/home');
  };

  const isHome = location.pathname === '/home';

  return (
    <header className="bg-[#F5C518] h-16 flex items-center justify-between px-6 shadow-md">
      <button
        data-testid="header-home-btn"
        onClick={handleHome}
        className={`nav-button ${isHome ? 'opacity-50 cursor-default' : ''}`}
        disabled={isHome}
      >
        Home
      </button>
      
      <button
        data-testid="header-logout-btn"
        onClick={handleLogout}
        className="bg-white hover:bg-gray-100 text-gray-800 px-4 py-2 rounded-md font-bold uppercase tracking-wide transition-colors border border-gray-300"
      >
        Esci
      </button>
    </header>
  );
};

export default Header;
