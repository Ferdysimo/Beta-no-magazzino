// Canonical product display order used across the app.
// Single source of truth: the warehouse request page (NuovaRichiestaPage).
// Any list of products (analisi, inventario, DDT, etc.) MUST use this
// helper so the experience is consistent everywhere.

export const PRODUCT_DISPLAY_ORDER = [
  'PESTO',
  'POMODORELLA',
  'TARTUFO',
  'POM SECCHI',
  'RAGU DI CINGHIALE',
  'PESTO DI PISTACCHI',
  'CIME DI RAPA',
  'PECORINO',
  'GRANA',
  'GUANCIALI',
  'PASSATA VIANDER',
  'FORCHETTE',
  'PIATTI POLPA',
  'BUSTE',
  'SCODELLE',
  'COPERCHI',
  'VINO RAGU',
  'RAGU DI CHIANINA',
  'VINO BIANCO',
  'VINO ROSSO',
  'RAGU',
];

// Rank: 0..N-1 for known products, MAX_SAFE_INTEGER for unknown.
export const productOrderRank = (name) => {
  const n = (name || '').trim().toUpperCase();
  const i = PRODUCT_DISPLAY_ORDER.indexOf(n);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

// Stable comparator: canonical order first, alphabetical (Italian) as tiebreak.
export const compareProductsByCanonicalOrder = (a, b) => {
  const ra = productOrderRank(a?.name);
  const rb = productOrderRank(b?.name);
  if (ra !== rb) return ra - rb;
  return ((a?.name) || '').localeCompare((b?.name) || '', 'it');
};

// Sort helper that accepts an extractor for plain string lists / items where
// the product name is not at `.name`.
export const sortByCanonicalOrder = (items, getName = (it) => it?.name) =>
  [...items].sort((a, b) => {
    const ra = productOrderRank(getName(a));
    const rb = productOrderRank(getName(b));
    if (ra !== rb) return ra - rb;
    return (getName(a) || '').localeCompare(getName(b) || '', 'it');
  });
