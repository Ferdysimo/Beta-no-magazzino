import React, { useEffect, useState } from 'react';
import { useOrders } from '../contexts/OrderContext';

const BACKGROUND_IMAGE = 'https://customer-assets.emergentagent.com/job_0180d0f0-c7fa-4463-a43a-ab97d28ecc52/artifacts/2g29cupn_monitor%20clienti.jpg';

// Compute the best grid (cols x rows) to fit N square cells inside (W x H),
// maximizing the cell side length.
const fitGrid = (count, W, H, gap) => {
  if (count <= 0 || W <= 0 || H <= 0) return { cols: 1, rows: 1, side: 0 };
  let best = { cols: 1, rows: count, side: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (W - gap * (cols - 1)) / cols;
    const cellH = (H - gap * (rows - 1)) / rows;
    const side = Math.floor(Math.min(cellW, cellH));
    if (side > best.side) best = { cols, rows, side };
  }
  return best;
};

const MonitorClientiPage = () => {
  const { orders } = useOrders();
  const [vp, setVp] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1920,
    h: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }));

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const monitorOrders = orders
    .filter(o => o.monitor_visible)
    .sort((a, b) => a.order_number - b.order_number);

  if (monitorOrders.length === 0) {
    return (
      <div
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url('${BACKGROUND_IMAGE}')` }}
        data-testid="monitor-empty"
      />
    );
  }

  const PAD = 24;                         // outer padding
  const GAP = 24;                         // gap between boxes
  const messagePx = Math.max(56, Math.min(140, Math.round(vp.h * 0.10)));
  const usableW = Math.max(0, vp.w - PAD * 2);
  const usableH = Math.max(0, vp.h - messagePx - PAD * 2);

  const { cols, side } = fitGrid(monitorOrders.length, usableW, usableH, GAP);
  // Limite massimo del box: cresce in modo dolce col numero di ordini,
  // così con pochi clienti i numeri restano leggibili senza essere troppo grandi.
  // 1 ordine ≈ 180px · 2 ≈ 194 · 4 ≈ 222 · 8+ ≈ 280 (cap)
  const MAX_BOX = Math.min(280, 180 + Math.max(0, monitorOrders.length - 1) * 14);
  const boxSide = Math.max(80, Math.min(MAX_BOX, Math.floor(side * 0.58)));
  const numberFontPx = Math.floor(boxSide * 0.66);
  const messageFontPx = Math.max(28, Math.min(80, Math.round(messagePx * 0.55)));
  // Rounded corners proportional to box size, then capped.
  const radius = Math.min(36, Math.round(boxSide * 0.12));

  return (
    <div
      className="fixed inset-0 bg-gray-900 flex flex-col overflow-hidden"
      data-testid="monitor-active"
    >
      <div
        className="flex-1 flex items-center justify-center"
        style={{ padding: `${PAD}px` }}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, ${boxSide}px)`,
            gap: `${GAP}px`,
            justifyItems: 'center',
            alignItems: 'center',
          }}
        >
          {monitorOrders.map((order) => (
            <div
              key={order.id}
              data-testid={`monitor-order-${order.order_number}`}
              className="flex items-center justify-center animate-pulse-slow"
              style={{
                width: `${boxSide}px`,
                height: `${boxSide}px`,
                borderRadius: `${radius}px`,
                background: 'linear-gradient(135deg, #FFE070 0%, #F5C518 55%, #E0AC00 100%)',
                boxShadow:
                  '0 18px 40px -12px rgba(0,0,0,0.55), inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -3px 0 rgba(0,0,0,0.15)',
              }}
            >
              <span
                className="font-black leading-none"
                style={{
                  fontSize: `${numberFontPx}px`,
                  color: '#1f1300',
                  textShadow: '0 2px 0 rgba(255,255,255,0.35)',
                  letterSpacing: '-0.02em',
                }}
              >
                {order.order_number > 99 ? String(order.order_number).slice(1) : order.order_number}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        className="flex items-center justify-center"
        style={{ height: `${messagePx}px` }}
      >
        <p
          className="text-white font-bold uppercase tracking-wider"
          style={{ fontSize: `${messageFontPx}px` }}
        >
          Il tuo piatto è pronto!
        </p>
      </div>
    </div>
  );
};

export default MonitorClientiPage;
