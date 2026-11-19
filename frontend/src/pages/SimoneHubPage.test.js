import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import SimoneHubPage, { SIMONE_HUBS } from './SimoneHubPage';


const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock('../components/Header', () => () => <div data-testid="header" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('SimoneHubPage', () => {
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
      root.render(<SimoneHubPage section={section} />);
      await Promise.resolve();
    });
  };

  test.each(Object.entries(SIMONE_HUBS))(
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

  test('torna alla Home di Simone', async () => {
    await renderSection('magazzino');
    const back = container.querySelector('[data-testid="tools-hub-back"]');
    await act(async () => back.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith('/home');
  });
});
