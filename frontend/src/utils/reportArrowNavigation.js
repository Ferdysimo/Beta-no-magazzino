const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const NUMERIC_FIELD_SELECTOR = 'input[inputmode="decimal"]:not([readonly]):not([disabled])';

const rectCenter = (rect) => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
});

const hasVisibleRect = (element) => {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  if (typeof window !== 'undefined' && window.getComputedStyle) {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }

  return true;
};

export const getReportNavigableFields = (container) => {
  if (!container?.querySelectorAll) return [];
  return Array.from(container.querySelectorAll(NUMERIC_FIELD_SELECTOR)).filter(hasVisibleRect);
};

export const findNextReportField = (fields, current, key) => {
  if (!ARROW_KEYS.has(key) || !current || !fields.includes(current)) return null;

  const currentRect = current.getBoundingClientRect();
  const currentCenter = rectCenter(currentRect);
  const candidates = fields
    .filter(field => field !== current)
    .map(field => {
      const rect = field.getBoundingClientRect();
      const center = rectCenter(rect);
      return {
        field,
        rect,
        dx: center.x - currentCenter.x,
        dy: center.y - currentCenter.y,
      };
    });

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const direction = key === 'ArrowLeft' ? -1 : 1;
    const sameRow = candidates.filter(({ rect, dx, dy }) => {
      const rowTolerance = Math.max(currentRect.height, rect.height) * 0.65;
      return dx * direction > 2 && Math.abs(dy) <= rowTolerance;
    });

    sameRow.sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx) || Math.abs(a.dy) - Math.abs(b.dy));
    return sameRow[0]?.field || null;
  }

  const direction = key === 'ArrowUp' ? -1 : 1;
  const vertical = candidates.filter(({ dy }) => dy * direction > 2);
  if (vertical.length === 0) return null;

  const nearestDistance = Math.min(...vertical.map(({ dy }) => Math.abs(dy)));
  const rowTolerance = Math.max(currentRect.height, 16);
  const nearestRow = vertical.filter(({ dy }) => Math.abs(dy) <= nearestDistance + rowTolerance);
  nearestRow.sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx) || Math.abs(a.dy) - Math.abs(b.dy));
  return nearestRow[0]?.field || null;
};

export const handleReportArrowNavigation = (event) => {
  if (
    !ARROW_KEYS.has(event.key)
    || event.defaultPrevented
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || event.nativeEvent?.isComposing
  ) {
    return false;
  }

  const current = event.target;
  if (
    current?.tagName !== 'INPUT'
    || current.getAttribute('inputmode') !== 'decimal'
    || current.readOnly
    || current.disabled
  ) {
    return false;
  }

  const fields = getReportNavigableFields(event.currentTarget);
  const next = findNextReportField(fields, current, event.key);
  if (!next) return false;

  event.preventDefault();
  next.focus({ preventScroll: true });
  if (typeof next.select === 'function') next.select();
  if (typeof next.scrollIntoView === 'function') {
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  return true;
};
