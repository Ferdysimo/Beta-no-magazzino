import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import FedericoHubPage, { FEDERICO_HUBS } from './FedericoHubPage';


const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock('../components/Header', () => () => <div data-testid="header" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('FedericoHubPage', () => {
  let container;
  let root;

  beforeEach(() => {
    mockNavigate.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderSection = async (section) => {
    await act(async () => {
      root.render(<FedericoHubPage section={section} />);
      await Promise.resolve();
    });
  };

  test.each(Object.entries(FEDERICO_HUBS))(
    'mostra tutti i collegamenti della sezione %s',
    async (section, hub) => {
      await renderSection(section);
      expect(container.textContent).toContain(hub.title);

      for (const item of hub.items) {
        const button = container.querySelector(`[data-testid="${item.testId}"]`);
        expect(button).not.toBeNull();
        await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(mockNavigate).toHaveBeenLastCalledWith(item.path);
      }
    },
  );

  test('torna alla Home di Federico', async () => {
    await renderSection('controlli');
    const back = container.querySelector('[data-testid="tools-hub-back"]');
    await act(async () => back.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith('/home');
  });
});
