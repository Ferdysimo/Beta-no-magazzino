import {
  findNextReportField,
  getReportNavigableFields,
  handleReportArrowNavigation,
} from './reportArrowNavigation';

const setRect = (element, left, top, width = 60, height = 40) => {
  element.getBoundingClientRect = () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  return element;
};

const createField = (left, top) => setRect(document.createElement('input'), left, top);

test('le frecce orizzontali restano sulla stessa riga', () => {
  const first = createField(0, 0);
  const second = createField(100, 0);
  const below = createField(0, 70);
  const fields = [first, second, below];

  expect(findNextReportField(fields, first, 'ArrowRight')).toBe(second);
  expect(findNextReportField(fields, second, 'ArrowLeft')).toBe(first);
  expect(findNextReportField(fields, first, 'ArrowLeft')).toBeNull();
});

test('le frecce verticali scelgono la casella piu allineata della riga vicina', () => {
  const topLeft = createField(0, 0);
  const topRight = createField(100, 0);
  const bottomLeft = createField(5, 70);
  const bottomRight = createField(105, 70);
  const fields = [topLeft, topRight, bottomLeft, bottomRight];

  expect(findNextReportField(fields, topRight, 'ArrowDown')).toBe(bottomRight);
  expect(findNextReportField(fields, bottomLeft, 'ArrowUp')).toBe(topLeft);
});

test('campi bloccati, disabilitati o nascosti non entrano nella navigazione', () => {
  const container = document.createElement('div');
  const editable = setRect(document.createElement('input'), 0, 0);
  editable.setAttribute('inputmode', 'decimal');
  const readonly = setRect(document.createElement('input'), 100, 0);
  readonly.setAttribute('inputmode', 'decimal');
  readonly.readOnly = true;
  const disabled = setRect(document.createElement('input'), 200, 0);
  disabled.setAttribute('inputmode', 'decimal');
  disabled.disabled = true;
  const hidden = setRect(document.createElement('input'), 300, 0, 0, 0);
  hidden.setAttribute('inputmode', 'decimal');
  container.append(editable, readonly, disabled, hidden);

  expect(getReportNavigableFields(container)).toEqual([editable]);
});

test('il gestore sposta il focus, seleziona il valore e preserva i modificatori', () => {
  const container = document.createElement('div');
  const first = setRect(document.createElement('input'), 0, 0);
  const second = setRect(document.createElement('input'), 100, 0);
  first.setAttribute('inputmode', 'decimal');
  second.setAttribute('inputmode', 'decimal');
  first.value = '12';
  second.value = '34';
  container.append(first, second);
  document.body.append(container);
  first.focus();
  const preventDefault = jest.fn();

  expect(handleReportArrowNavigation({
    key: 'ArrowRight',
    target: first,
    currentTarget: container,
    preventDefault,
    defaultPrevented: false,
  })).toBe(true);
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(second);
  expect(second.selectionStart).toBe(0);
  expect(second.selectionEnd).toBe(2);

  expect(handleReportArrowNavigation({
    key: 'ArrowLeft',
    target: second,
    currentTarget: container,
    preventDefault,
    defaultPrevented: false,
    ctrlKey: true,
  })).toBe(false);

  container.remove();
});
