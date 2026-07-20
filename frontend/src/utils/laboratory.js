export const canAccessLaboratory = (restaurant) => (
  restaurant?.username === 'Simone' && restaurant?.role === 'admin'
);
