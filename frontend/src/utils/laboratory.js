export const canAccessLaboratory = (restaurant) => (
  restaurant?.username === 'Simone' && restaurant?.role === 'admin'
);

export const formatSourceTerms = (terms, limit = 4) => {
  const values = (terms || []).filter(term => term?.value);
  const visible = values
    .slice(0, limit)
    .map(term => `${term.value} (${Number(term.count || 0).toLocaleString('it-IT')})`);
  const remaining = Math.max(values.length - visible.length, 0);
  return remaining ? `${visible.join(' · ')} · +${remaining}` : visible.join(' · ');
};

export const filterPastaAnnotations = (annotations, search, pasta) => {
  const normalizedSearch = String(search || '').trim().toUpperCase();
  return (annotations || []).filter((item) => {
    const matchesSearch = !normalizedSearch
      || String(item.annotation || '').toUpperCase().includes(normalizedSearch)
      || (item.raw_variants || []).some(variant => (
        String(variant.value || '').toUpperCase().includes(normalizedSearch)
      ));
    const matchesPasta = !pasta || Number(item.pasta_counts?.[pasta] || 0) > 0;
    return matchesSearch && matchesPasta;
  });
};

const hasPasta = (item, pasta) => (
  !pasta || Number(item?.pasta_counts?.[pasta] || 0) > 0
);

export const filterSemanticSignals = (signals, search, pasta) => {
  const normalizedSearch = String(search || '').trim().toUpperCase();
  return (signals || []).filter((item) => {
    const sourceTerms = (item.source_terms || []).map(term => term.value);
    const matchesSearch = !normalizedSearch || [
      item.label,
      item.dimension,
      item.code,
      item.target,
      ...sourceTerms,
    ].some(value => String(value || '').toUpperCase().includes(normalizedSearch));
    return matchesSearch && hasPasta(item, pasta);
  });
};

export const filterUnknownFragments = (fragments, search, pasta) => {
  const normalizedSearch = String(search || '').trim().toUpperCase();
  return (fragments || []).filter(item => (
    (!normalizedSearch
      || String(item.fragment || '').toUpperCase().includes(normalizedSearch))
    && hasPasta(item, pasta)
  ));
};

export const filterPagerGroups = (groups, search, pasta) => {
  const normalizedSearch = String(search || '').trim().toUpperCase();
  return (groups || []).filter((item) => {
    const matchesSearch = !normalizedSearch || [
      item.location,
      item.business_date,
      item.pager,
      ...(item.annotations || []),
    ].some(value => String(value ?? '').toUpperCase().includes(normalizedSearch));
    const matchesPasta = !pasta || Number(item.pasta_counts?.[pasta] || 0) > 0;
    return matchesSearch && matchesPasta;
  });
};
