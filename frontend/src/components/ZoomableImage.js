import React, { useState, useEffect } from 'react';

/**
 * Img wrapper che apre un lightbox a tutto schermo al click.
 * Drop-in replacement per <img>: passa src/alt/className come al solito.
 *
 * Esempio:
 *   <ZoomableImage src={url} alt="DDT" className="w-32 h-32 object-cover" />
 */
const ZoomableImage = ({ src, alt = '', className = '', ...rest }) => {
  const [open, setOpen] = useState(false);

  // ESC chiude il lightbox + previene scroll body quando aperto
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!src) return null;

  return (
    <>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onClick={() => setOpen(true)}
        className={`cursor-zoom-in transition-opacity hover:opacity-90 ${className}`}
        {...rest}
      />
      {open && (
        <div
          data-testid="image-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in"
        >
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain shadow-2xl cursor-zoom-out"
            style={{ touchAction: 'pinch-zoom' }}
          />
          <button
            type="button"
            data-testid="image-lightbox-close"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            className="absolute top-4 right-4 bg-white/10 hover:bg-white/25 text-white text-3xl w-12 h-12 rounded-full flex items-center justify-center transition-colors"
            aria-label="Chiudi"
          >
            ×
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-xs">
            Clicca fuori o premi Esc per chiudere
          </span>
        </div>
      )}
    </>
  );
};

export default ZoomableImage;
export { ZoomableImage };
