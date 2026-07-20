export const canAccessLaboratory = (restaurant) => (
  restaurant?.username === 'Simone' && restaurant?.role === 'admin'
);

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
