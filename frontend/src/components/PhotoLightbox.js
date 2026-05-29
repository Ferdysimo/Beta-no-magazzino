import React, { useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import PanZoomImage from './PanZoomImage';

// Reusable photo lightbox with prev/next navigation (arrow keys + buttons).
// Props:
//   photos: Array<{ url: string, label?: string }>
//   index: number (current index)
//   onChangeIndex: (newIndex: number) => void
//   onClose: () => void
//   resolve: optional (url) => absolute url
const PhotoLightbox = ({ photos, index, onChangeIndex, onClose, resolve }) => {
  const total = photos?.length || 0;

  const prev = useCallback(() => {
    if (total < 2) return;
    onChangeIndex((index - 1 + total) % total);
  }, [index, total, onChangeIndex]);

  const next = useCallback(() => {
    if (total < 2) return;
    onChangeIndex((index + 1) % total);
  }, [index, total, onChangeIndex]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose]);

  if (!photos || total === 0 || index < 0 || index >= total) return null;

  const current = photos[index];
  const src = resolve ? resolve(current.url) : current.url;

  return (
    <div
      className="fixed inset-0 bg-black/95 flex items-center justify-center p-4"
      style={{ zIndex: 9999 }}
      onClick={onClose}
      data-testid="photo-lightbox"
    >
      {/* Close */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur"
        data-testid="photo-lightbox-close"
        title="Chiudi (Esc)"
      >
        <X size={22} />
      </button>

      {/* Counter / Label */}
      <div className="absolute top-4 left-4 text-white text-sm bg-white/10 backdrop-blur px-3 py-1 rounded-full">
        {total > 1 && <span className="font-semibold">{index + 1}/{total}</span>}
        {current.label && <span className={total > 1 ? 'ml-2 opacity-90' : 'font-semibold'}>{current.label}</span>}
      </div>

      {/* Prev */}
      {total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); prev(); }}
          className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur"
          data-testid="photo-lightbox-prev"
          title="Precedente (←)"
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Next */}
      {total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); next(); }}
          className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur"
          data-testid="photo-lightbox-next"
          title="Successiva (→)"
        >
          <ChevronRight size={28} />
        </button>
      )}

      {/* Image (pan + zoom: wheel desktop, pinch su mobile, doppio click reset) */}
      <PanZoomImage src={src} alt={current.label || 'photo'} />

      {/* Hint zoom (sparisce dopo 3s) */}
      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-xs select-none pointer-events-none bg-black/30 backdrop-blur px-3 py-1 rounded-full">
        Pinch / rotellina per zoom · doppio click per reset
      </span>
    </div>
  );
};

export default PhotoLightbox;
