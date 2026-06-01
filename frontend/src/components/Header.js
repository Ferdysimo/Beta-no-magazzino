import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// Build version - changes force CDN cache invalidation
export const APP_VERSION = '2026060108';

const Header = () => {
  const { logout, canImpersonate, effectiveRestaurant, clearSelectedRestaurant } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleHome = () => {
    // Per Admin/Supervisor che stanno impersonando un locale, "Home" torna alla
    // dashboard di selezione, non resta dentro al locale impersonato.
    if (canImpersonate && effectiveRestaurant) {
      clearSelectedRestaurant();
    }
    navigate('/home');
  };

  const handleSwitchLocation = () => {
    clearSelectedRestaurant();
    navigate('/home');
  };

  const isHome = location.pathname === '/home';

  return (
    <header className="bg-[#F5C518] h-16 flex items-center justify-between px-6 shadow-md">
      <div className="flex items-center gap-3">
        <button
          data-testid="header-home-btn"
          onClick={handleHome}
          className={`nav-button ${isHome ? 'opacity-50 cursor-default' : ''}`}
          disabled={isHome}
        >
          Home
        </button>
        {canImpersonate && effectiveRestaurant && (
          <button
            data-testid="header-switch-location"
            onClick={handleSwitchLocation}
            className="bg-white/80 hover:bg-white text-gray-800 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            {effectiveRestaurant.location} ▼
          </button>
        )}
      </div>
      
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
