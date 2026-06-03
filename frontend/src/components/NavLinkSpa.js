import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Link che si comporta come una `navigate(to)` al click normale ma
 * permette nativamente di aprire in nuova scheda con:
 *  - Ctrl+click (Windows/Linux)
 *  - Cmd+click (macOS)
 *  - Shift+click (nuova finestra)
 *  - Click centrale (rotellina)
 *  - Tasto destro → "Apri in nuova scheda"
 *
 * Mantiene la stessa estetica del `<button>` precedente: basta passargli
 * `className`. Render come `<a>` per attivare l'open-in-new-tab del browser.
 */
const NavLinkSpa = ({ to, className = '', children, title, dataTestid }) => {
  const navigate = useNavigate();
  const onClick = (e) => {
    // Lascia che il browser gestisca tab/finestra nuova
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a
      href={to}
      onClick={onClick}
      className={className}
      title={title}
      data-testid={dataTestid}
    >
      {children}
    </a>
  );
};

export default NavLinkSpa;
