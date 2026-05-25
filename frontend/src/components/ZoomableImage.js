import React, { useState, useEffect } from 'react';

/**
 * Wrapper d'immagine che apre un lightbox a tutto schermo al click.
 * Drop-in replacement per <img>: stesse props (src/alt/className).
 *
 * Implementazione robusta:
 *  - Il click handler vive su un <span> wrapper, non sull'<img>, così funziona
 *    anche su mobile e quando il parent ha event handlers.
 *  - stopPropagation + preventDefault per evitare che pagine con onClick sul
 *    contenitore (card prodotto, ecc.) interferiscano.
 *  - Lightbox in portale logico con z-index 9999, bloccando scroll body.
 *  - ESC, click sull'overlay o sul pulsante chiude.
 */
const ZoomableImage = ({ src, alt = '', className = '', style, ...rest }) => {
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

  const handleOpen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };
  const handleClose = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setOpen(false);
  };

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-label={alt ? `Ingrandisci ${alt}` : 'Ingrandisci foto'}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
        }}
        data-testid="zoomable-trigger"
        className="block w-full h-full cursor-zoom-in"
        style={{ touchAction: 'manipulation' }}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          className={`pointer-events-none select-none ${className}`}
          style={style}
          {...rest}
        />
      </span>

      {open && (
        <div
          data-testid="image-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={handleClose}
          className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 cursor-zoom-out"
          style={{ zIndex: 9999 }}
        >
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            className="max-w-full max-h-full object-contain shadow-2xl select-none"
            style={{ touchAction: 'pinch-zoom' }}
          />
          <button
            type="button"
            data-testid="image-lightbox-close"
            onClick={handleClose}
            className="absolute top-4 right-4 bg-white/15 hover:bg-white/30 text-white text-2xl font-light w-12 h-12 rounded-full flex items-center justify-center transition-colors backdrop-blur"
            aria-label="Chiudi"
          >
            ×
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-xs select-none">
            Clicca fuori o premi Esc per chiudere
          </span>
        </div>
      )}
    </>
  );
};

export default ZoomableImage;
export { ZoomableImage };
