import { applyImpersonationHeaders } from './AuthContext';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  },
}));

describe('applyImpersonationHeaders', () => {
  test('aggiunge entrambi gli header al traffico impersonato ordinario', () => {
    const config = applyImpersonationHeaders(
      { headers: { Authorization: 'Bearer token' } },
      { id: 'brazza-id' },
    );

    expect(config.headers['X-Restaurant-Id']).toBe('brazza-id');
    expect(config.headers['X-Admin-Restaurant-Id']).toBe('brazza-id');
  });

  test('non riscrive il locale catturato da un autosave gia accodato', () => {
    const config = applyImpersonationHeaders({
      headers: {
        'X-Restaurant-Id': 'brazza-id',
        'X-Admin-Restaurant-Id': 'brazza-id',
      },
    }, { id: 'grazie-id' });

    expect(config.headers['X-Restaurant-Id']).toBe('brazza-id');
    expect(config.headers['X-Admin-Restaurant-Id']).toBe('brazza-id');
  });
});
