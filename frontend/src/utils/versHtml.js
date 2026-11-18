const canonicalVersColor = (color) => {
  const normalized = String(color || '').toLowerCase().replace(/\s+/g, '');
  if (['red', '#dc2626', 'rgb(220,38,38)'].includes(normalized)) return '#dc2626';
  if (['black', '#111827', 'rgb(17,24,39)'].includes(normalized)) return '#111827';
  return '';
};

const escapeText = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export const sanitizeVersHtml = (html) => {
  if (!html || typeof html !== 'string') return '';
  if (typeof document === 'undefined') return escapeText(html.replace(/<[^>]*>/g, ''));

  // Il contenuto di <template> resta inerte. Ricostruiamo un albero nuovo
  // contenente esclusivamente testo e span con i due colori supportati.
  const input = document.createElement('template');
  input.innerHTML = html;
  const output = document.createElement('div');
  const copySafe = (source, target) => {
    Array.from(source.childNodes).forEach(node => {
      if (node.nodeType === 3) {
        target.appendChild(document.createTextNode(node.textContent || ''));
        return;
      }
      if (node.nodeType !== 1) return;
      if (['SCRIPT', 'STYLE', 'SVG', 'MATH', 'IFRAME', 'OBJECT', 'EMBED'].includes(node.tagName)) return;
      if (node.tagName !== 'SPAN') {
        target.appendChild(document.createTextNode(node.textContent || ''));
        return;
      }
      const span = document.createElement('span');
      const color = canonicalVersColor(node.style?.color);
      if (color) span.style.color = color;
      copySafe(node, span);
      target.appendChild(span);
    });
  };
  copySafe(input.content, output);
  return output.innerHTML;
};

export const parseVersSegments = (html, legacyColor = '') => {
  const legacyRed = canonicalVersColor(legacyColor) === '#dc2626';
  const segments = [];
  const append = (text, red) => {
    const safeText = String(text || '').replace(/[^0-9+\-*/.(),=\s€]/g, '');
    if (!safeText) return;
    const previous = segments[segments.length - 1];
    if (previous && previous.red === red) previous.text += safeText;
    else segments.push({ text: safeText, red });
  };

  const clean = sanitizeVersHtml(String(html || ''));
  if (typeof document === 'undefined') {
    append(clean.replace(/<[^>]*>/g, ''), legacyRed);
  } else {
    const template = document.createElement('template');
    template.innerHTML = clean;
    const walk = (node, inheritedRed) => {
      if (node.nodeType === 3) {
        append(node.textContent, inheritedRed);
        return;
      }
      if (node.nodeType !== 1) return;
      const ownColor = canonicalVersColor(node.style?.color);
      const red = ownColor ? ownColor === '#dc2626' : inheritedRed;
      Array.from(node.childNodes).forEach(child => walk(child, red));
    };
    Array.from(template.content.childNodes).forEach(child => walk(child, legacyRed));
  }
  const hasRedNumbers = segments.some(segment => segment.red && /\d/.test(segment.text));
  const hasBlackNumbers = segments.some(segment => !segment.red && /\d/.test(segment.text));
  return { segments, mixed: hasRedNumbers && hasBlackNumbers };
};

export const versHasMixedColors = (html) => parseVersSegments(html).mixed;
