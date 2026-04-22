// Client-side image compression before upload.
// Reduces mobile photos from 5-10 MB to ~200-500 KB while keeping text legible.
// Works on iOS/Android, respects EXIF orientation via createImageBitmap.

const DEFAULT_MAX_DIM = 1600;
const DEFAULT_QUALITY = 0.8;

export async function compressImage(file, options = {}) {
  const maxDim = options.maxDim || DEFAULT_MAX_DIM;
  const quality = options.quality || DEFAULT_QUALITY;

  if (!file) throw new Error('Nessun file fornito');

  // Non-image files: return original dataURL
  if (!file.type.startsWith('image/')) {
    const dataUrl = await readFileAsDataURL(file);
    return { dataUrl, sizeKB: Math.round(file.size / 1024) };
  }

  // Decode image (honoring EXIF orientation on modern browsers)
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Fallback: load via <img>
    const dataUrl = await readFileAsDataURL(file);
    bitmap = await loadImage(dataUrl);
  }

  const { width: w0, height: h0 } = bitmap;
  const ratio = Math.min(1, maxDim / Math.max(w0, h0));
  const w = Math.round(w0 * ratio);
  const h = Math.round(h0 * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // White background in case of transparent PNGs (JPEG has no alpha)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  // Rough size estimation from base64 payload
  const b64 = dataUrl.split(',')[1] || '';
  const sizeKB = Math.round((b64.length * 3) / 4 / 1024);
  return { dataUrl, sizeKB };
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Errore lettura file'));
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Immagine non valida'));
    img.src = src;
  });
}

// Extract a short, friendly network error message for mobile users.
export function friendlyUploadError(err) {
  if (!err) return 'Errore sconosciuto';
  if (err.response?.data?.detail) return err.response.data.detail;
  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
    return 'Connessione lenta o interrotta. Controlla il segnale e riprova.';
  }
  if (err.response?.status === 413) {
    return 'File troppo grande per il server. Riprova.';
  }
  if (!navigator.onLine) {
    return 'Sei offline. Connettiti alla rete e riprova.';
  }
  return err.message || 'Errore di rete. Riprova.';
}
