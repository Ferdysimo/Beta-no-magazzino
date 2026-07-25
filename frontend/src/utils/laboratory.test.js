import {
  canAccessLaboratory,
  filterPagerGroups,
  filterPastaAnnotations,
  filterSemanticSignals,
  filterUnknownFragments,
  formatSourceTerms,
} from './laboratory';

describe('canAccessLaboratory', () => {
  test('allows only the Simone admin account', () => {
    expect(canAccessLaboratory({ username: 'Simone', role: 'admin' })).toBe(true);
    expect(canAccessLaboratory({ username: 'Admin', role: 'admin' })).toBe(false);
    expect(canAccessLaboratory({ username: 'Simone', role: 'restaurant' })).toBe(false);
    expect(canAccessLaboratory(null)).toBe(false);
  });
});

describe('filterPastaAnnotations', () => {
  const annotations = [
    {
      annotation: 'NO PEPE',
      pasta_counts: { CARB: 4, AMAT: 1 },
      raw_variants: [{ value: 'No pepe', count: 5 }],
    },
    {
      annotation: 'ASPORTO',
      pasta_counts: { AMAT: 3 },
      raw_variants: [],
    },
  ];

  test('filters by normalized text and pasta without changing the source', () => {
    expect(filterPastaAnnotations(annotations, 'pepe', 'CARB')).toEqual([annotations[0]]);
    expect(filterPastaAnnotations(annotations, '', 'AMAT')).toEqual(annotations);
    expect(filterPastaAnnotations(annotations, 'asporto', 'CARB')).toEqual([]);
    expect(annotations).toHaveLength(2);
  });
});

describe('semantic annotation filters', () => {
  const signals = [
    {
      label: 'Take away',
      dimension: 'service_mode',
      code: 'take_away',
      pasta_counts: { CARB: 8 },
      source_terms: [{ value: 'TA', count: 8 }],
    },
    {
      label: 'Senza pepe',
      dimension: 'preparation_request',
      code: 'without:pepe',
      target: 'PEPE',
      pasta_counts: { CACIO: 3 },
      source_terms: [{ value: 'NO PEPE', count: 3 }],
    },
  ];

  test('filters signals by label, source term and pasta', () => {
    expect(filterSemanticSignals(signals, 'ta', 'CARB')).toEqual([signals[0]]);
    expect(filterSemanticSignals(signals, 'no pepe', 'CACIO')).toEqual([signals[1]]);
    expect(filterSemanticSignals(signals, 'pepe', 'CARB')).toEqual([]);
  });

  test('filters unknown fragments and reconstructed group examples', () => {
    const unknowns = [
      { fragment: 'T', pasta_counts: { CARB: 2 } },
      { fragment: 'DEL', pasta_counts: { AMAT: 4 } },
    ];
    const groups = [
      {
        location: 'Flaminio',
        business_date: '2026-07-22',
        pager: 12,
        annotations: ['C TA'],
        pasta_counts: { CARB: 2 },
      },
    ];

    expect(filterUnknownFragments(unknowns, 'del', '')).toEqual([unknowns[1]]);
    expect(filterUnknownFragments(unknowns, '', 'CARB')).toEqual([unknowns[0]]);
    expect(filterPagerGroups(groups, '12', 'CARB')).toEqual(groups);
    expect(filterPagerGroups(groups, 'grazie', '')).toEqual([]);
  });
});

describe('formatSourceTerms', () => {
  test('shows counted variants without overcrowding the signal row', () => {
    const terms = [
      { value: 'NO GUANC', count: 33 },
      { value: 'NO GUANCIALE', count: 7 },
      { value: 'SENZA GUANCIALE', count: 32 },
      { value: 'SENZA GUANC', count: 15 },
      { value: 'NO GUAN', count: 1 },
    ];

    expect(formatSourceTerms(terms)).toBe(
      'NO GUANC (33) · NO GUANCIALE (7) · SENZA GUANCIALE (32) · SENZA GUANC (15) · +1',
    );
    expect(terms).toHaveLength(5);
  });
});
