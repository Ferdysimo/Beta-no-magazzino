import { canAccessLaboratory } from './laboratory';

describe('canAccessLaboratory', () => {
  test('allows only the Simone admin account', () => {
    expect(canAccessLaboratory({ username: 'Simone', role: 'admin' })).toBe(true);
    expect(canAccessLaboratory({ username: 'Admin', role: 'admin' })).toBe(false);
    expect(canAccessLaboratory({ username: 'Simone', role: 'restaurant' })).toBe(false);
    expect(canAccessLaboratory(null)).toBe(false);
  });
});
