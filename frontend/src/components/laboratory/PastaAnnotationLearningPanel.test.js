import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PastaAnnotationLearningPanel from './PastaAnnotationLearningPanel';

global.IS_REACT_ACT_ENVIRONMENT = true;

const suggestion = {
  id: 'pair-1',
  reason: 'Possibile abbreviazione',
  similarity_percent: 91,
  suggested_canonical: 'GUANCIALE',
  suggested_alias: 'GUANCI',
  left: {
    target: 'GUANCIALE',
    count: 40,
    source_terms: [{ value: 'NO GUANCIALE', count: 40 }],
    location_counts: { Flaminio: 40 },
  },
  right: {
    target: 'GUANCI',
    count: 3,
    source_terms: [{ value: 'NO GUANCI', count: 3 }],
    location_counts: { Grazie: 3 },
  },
};

describe('PastaAnnotationLearningPanel', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('mostra le prove e inoltra una decisione esplicita', () => {
    const onDecision = jest.fn();

    act(() => {
      root.render(
        <PastaAnnotationLearningPanel
          suggestions={[suggestion]}
          confirmedAliases={[]}
          dismissedPairs={[]}
          message=""
          saving={false}
          onDecision={onDecision}
          onUndo={jest.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('GUANCIALE');
    expect(container.textContent).toContain('GUANCI');
    expect(container.textContent).toContain('Somiglianza 91%');
    const sameButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent.includes('Uguali'));

    act(() => {
      sameButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onDecision).toHaveBeenCalledWith(suggestion, 'same');
  });

  test('rende annullabile una regola gia registrata', () => {
    const onUndo = jest.fn();
    const alias = {
      id: 'alias-1',
      alias_normalized: 'GUANCI',
      canonical_normalized: 'GUANCIALE',
    };

    act(() => {
      root.render(
        <PastaAnnotationLearningPanel
          suggestions={[]}
          confirmedAliases={[alias]}
          dismissedPairs={[]}
          message=""
          saving={false}
          onDecision={jest.fn()}
          onUndo={onUndo}
        />,
      );
    });

    const undoButton = container.querySelector(
      'button[aria-label="Annulla regola GUANCI"]',
    );
    act(() => {
      undoButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUndo).toHaveBeenCalledWith(alias);
  });
});
