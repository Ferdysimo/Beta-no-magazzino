// Canonical product display order used across the app.
// Single source of truth for richieste, analisi, DDT, inventario, ecc.
//
// Regole:
//   1) Prodotti nella lista PRODUCT_DISPLAY_ORDER → ranking 0..N-1
//   2) Prodotti del fornitore "GIOIA" → SEMPRE alla fine (alfabetico interno)
//   3) Altri prodotti sconosciuti → in coda dopo GIOIA (alfabetico)

export const PRODUCT_DISPLAY_ORDER = [
  'PESTO',
  'POMODORELLA',
  'TARTUFO',
  'POM SECCHI',
  'CINGHIALE',
  'PESTO DI PISTACCHI',
  'CIME DI RAPA',
  'PECORINO',
  'GRANA',
  'GUANCIALE',
  'PASSATA VIANDER',
  'FORCHETTE',
  'PIATTI POLPA',
  'BUSTE',
  'SCODELLE',
  'COPERCHI',
  'VINO BIANCO',
  'VINO ROSSO',
  'RAGU',
  'SEMOLE',
  'FARINA',
  'UOVA',
];

const GIOIA_RANK = 1_000_000;
const UNKNOWN_RANK = 2_000_000;

const norm = (s) => (s || '').toString().trim().toUpperCase();
const isGioia = (supplier) => norm(supplier) === 'GIOIA';

// Rank di un prodotto (oggetto completo con .name e .supplier)
export const rankForProduct = (product) => {
  const n = norm(product?.name);
  const idx = PRODUCT_DISPLAY_ORDER.indexOf(n);
  if (idx !== -1) return idx;
  if (isGioia(product?.supplier)) return GIOIA_RANK;
  return UNKNOWN_RANK;
};

// Rank basato sul solo nome (back-compat per callers che non hanno l'oggetto)
export const productOrderRank = (name) => {
  const n = norm(name);
  const i = PRODUCT_DISPLAY_ORDER.indexOf(n);
  return i === -1 ? UNKNOWN_RANK : i;
};

// Comparator stabile: rank canonico, poi alfabetico (italiano)
export const compareProductsByCanonicalOrder = (a, b) => {
  const ra = rankForProduct(a);
  const rb = rankForProduct(b);
  if (ra !== rb) return ra - rb;
  return ((a?.name) || '').localeCompare((b?.name) || '', 'it');
};

// Helper: sort generico, accetta extractor di nome (default: it.name) ed extractor opzionale di supplier
export const sortByCanonicalOrder = (
  items,
  getName = (it) => it?.name,
  getSupplier = (it) => it?.supplier,
) =>
  [...items].sort((a, b) => {
    const pa = { name: getName(a), supplier: getSupplier(a) };
    const pb = { name: getName(b), supplier: getSupplier(b) };
    const ra = rankForProduct(pa);
    const rb = rankForProduct(pb);
    if (ra !== rb) return ra - rb;
    return (pa.name || '').localeCompare(pb.name || '', 'it');
  });
