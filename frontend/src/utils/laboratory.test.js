import { canAccessLaboratory, filterPastaAnnotations } from './laboratory';

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
