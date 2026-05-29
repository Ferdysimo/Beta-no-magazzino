import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * <PanZoomImage src=... alt=... onSingleClick? />
 *
 * Riempie il contenitore parent e mostra l'immagine con:
 *  - Rotellina mouse  → zoom in/out centrato sul puntatore
 *  - Pinch 2 dita     → zoom in/out (telefono/tablet)
 *  - Drag (mouse o 1 dito) quando zoomato → pan
 *  - Doppio click / doppio tap → reset zoom 1×
 *  - Click semplice (quando NON zoomato) → callback onSingleClick (es. chiusura lightbox)
 *
 * Lo zoom è clampato in [1, 6]. Quando torna a 1, l'immagine si ricentra.
 * Resetta automaticamente lo stato quando cambia `src`.
 */
const MIN_SCALE = 1;
const MAX_SCALE = 6;

const PanZoomImage = ({ src, alt = '', onSingleClick, onSwipeLeft, onSwipeRight }) => {
  const wrapRef = useRef(null);
  const imgRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  // refs per le interazioni in tempo reale (evita re-render durante il drag)
  const stateRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef(null);   // { startX, startY, baseTx, baseTy }
  const pinchRef = useRef(null);  // { dist, midX, midY, baseScale, baseTx, baseTy }
  const swipeRef = useRef(null);  // { startX, startY } — solo a scale=1
  const lastTapRef = useRef(0);
  const movedRef = useRef(false);

  // Sync refs <-> state
  useEffect(() => { stateRef.current = { scale, tx, ty }; }, [scale, tx, ty]);

  // Reset quando cambia foto
  useEffect(() => {
    setScale(1); setTx(0); setTy(0);
    dragRef.current = null; pinchRef.current = null;
  }, [src]);

  const clamp = (s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

  const applyZoomAt = useCallback((clientX, clientY, nextScaleRaw) => {
    const el = wrapRef.current;
    if (!el) return;
    const next = clamp(nextScaleRaw);
    const { scale: cur, tx: ctx, ty: cty } = stateRef.current;
    if (next === cur) return;
    // Punto di ancoraggio nel sistema "immagine" prima dello zoom
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // posizione del puntatore rispetto al centro dell'immagine (al suo stato attuale)
    const dx = clientX - cx - ctx;
    const dy = clientY - cy - cty;
    const ratio = next / cur;
    let newTx = ctx + dx - dx * ratio;
    let newTy = cty + dy - dy * ratio;
    if (next === 1) { newTx = 0; newTy = 0; }
    setScale(next); setTx(newTx); setTy(newTy);
  }, []);

  // ===== Wheel (desktop) =====
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      applyZoomAt(e.clientX, e.clientY, stateRef.current.scale * factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoomAt]);

  // ===== Mouse drag (pan quando zoomato) =====
  const onMouseDown = (e) => {
    if (stateRef.current.scale <= 1) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      baseTx: stateRef.current.tx, baseTy: stateRef.current.ty,
    };
    movedRef.current = false;
  };
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const d = dragRef.current;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
      setTx(d.baseTx + dx); setTy(d.baseTy + dy);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ===== Touch (pinch + 1-finger pan) =====
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      pinchRef.current = {
        dist, midX, midY,
        baseScale: stateRef.current.scale,
        baseTx: stateRef.current.tx,
        baseTy: stateRef.current.ty,
      };
      dragRef.current = null;
      movedRef.current = true;
    } else if (e.touches.length === 1) {
      if (stateRef.current.scale > 1) {
        const t = e.touches[0];
        dragRef.current = {
          startX: t.clientX, startY: t.clientY,
          baseTx: stateRef.current.tx, baseTy: stateRef.current.ty,
        };
      } else if (onSwipeLeft || onSwipeRight) {
        // A scale=1, traccio un possibile swipe orizzontale per la navigazione.
        const t = e.touches[0];
        swipeRef.current = { startX: t.clientX, startY: t.clientY };
      }
      movedRef.current = false;
    }
  };

  const onTouchMove = (e) => {
    if (pinchRef.current && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const p = pinchRef.current;
      const next = clamp(p.baseScale * (dist / Math.max(1, p.dist)));
      applyZoomAt(p.midX, p.midY, next);
    } else if (dragRef.current && e.touches.length === 1) {
      const t = e.touches[0];
      const d = dragRef.current;
      const dx = t.clientX - d.startX;
      const dy = t.clientY - d.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
      setTx(d.baseTx + dx); setTy(d.baseTy + dy);
      e.preventDefault();
    } else if (swipeRef.current && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - swipeRef.current.startX;
      const dy = t.clientY - swipeRef.current.startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) movedRef.current = true;
    }
  };

  const onTouchEnd = (e) => {
    // Swipe orizzontale a scale=1 (prima di chiudere lo swipeRef)
    if (
      swipeRef.current &&
      e.touches.length === 0 &&
      e.changedTouches && e.changedTouches.length === 1 &&
      stateRef.current.scale <= 1
    ) {
      const t = e.changedTouches[0];
      const dx = t.clientX - swipeRef.current.startX;
      const dy = t.clientY - swipeRef.current.startY;
      // Soglia: 50px orizzontali, orizzontale almeno 2× verticale
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2) {
        if (dx < 0 && onSwipeLeft) onSwipeLeft();
        else if (dx > 0 && onSwipeRight) onSwipeRight();
        movedRef.current = true;
      }
    }
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) { dragRef.current = null; swipeRef.current = null; }
    // double-tap reset
    const now = Date.now();
    if (e.changedTouches && e.changedTouches.length === 1 && !movedRef.current) {
      if (now - lastTapRef.current < 280) {
        if (stateRef.current.scale > 1) {
          setScale(1); setTx(0); setTy(0);
        } else {
          // zoom-in 2.5× sul punto del tap
          const t = e.changedTouches[0];
          applyZoomAt(t.clientX, t.clientY, 2.5);
        }
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    }
  };

  const onDoubleClick = (e) => {
    e.stopPropagation();
    if (stateRef.current.scale > 1) {
      setScale(1); setTx(0); setTy(0);
    } else {
      applyZoomAt(e.clientX, e.clientY, 2.5);
    }
  };

  const onClick = (e) => {
    // Stop SEMPRE la propagazione del click: il backdrop chiude solo via X / Esc.
    // Questo evita che durante zoom/pan/double-tap il lightbox si chiuda.
    e.stopPropagation();
    if (movedRef.current) { movedRef.current = false; return; }
    if (stateRef.current.scale > 1) return;
    if (onSingleClick) onSingleClick(e);
  };

  return (
    <div
      ref={wrapRef}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onDoubleClick={onDoubleClick}
      onClick={onClick}
      className="absolute inset-0 flex items-center justify-center overflow-hidden select-none"
      style={{
        touchAction: 'none',
        cursor: scale > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'zoom-in',
      }}
      data-testid="pan-zoom-image"
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="max-w-full max-h-full object-contain shadow-2xl select-none pointer-events-none"
        style={{
          transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
          transformOrigin: 'center center',
          transition: dragRef.current || pinchRef.current ? 'none' : 'transform 120ms ease-out',
          willChange: 'transform',
        }}
      />
    </div>
  );
};

export default PanZoomImage;
