import React, { useState, useEffect } from 'react';
import PanZoomImage from './PanZoomImage';

/**
 * Click su un'immagine → lightbox a tutto schermo.
 * Implementazione minima: click handler direttamente sull'img.
 */
const ZoomableImage = ({ src, alt = '', className = '', ...rest }) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!src) return null;

  return (
    <>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`cursor-zoom-in ${className}`}
        {...rest}
      />
      {open && (
        <div
          data-testid="image-lightbox"
          onClick={() => setOpen(false)}
          className="fixed inset-0 bg-black/95 flex items-center justify-center p-4"
          style={{ zIndex: 9999 }}
        >
          <PanZoomImage src={src} alt={alt} />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            className="absolute top-4 right-4 bg-white/15 hover:bg-white/30 text-white text-2xl w-12 h-12 rounded-full flex items-center justify-center backdrop-blur z-10"
            aria-label="Chiudi"
          >
            ×
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-xs select-none pointer-events-none bg-black/30 backdrop-blur px-3 py-1 rounded-full">
            Pinch / rotellina per zoom · doppio click per reset · Esc per chiudere
          </span>
        </div>
      )}
    </>
  );
};

export default ZoomableImage;
export { ZoomableImage };
