export const MAX_EXPRESSION_LENGTH = 200;
const MAX_OPERATIONS = 100;
const MAX_DEPTH = 20;

const normalizedExpression = (value, stripHtml) => {
  if (value === '' || value === null || value === undefined) return '';
  let expression = String(value);
  if (stripHtml && expression.includes('<')) expression = expression.replace(/<[^>]*>/g, '');
  expression = expression.trim().replace(/,/g, '.');
  if (expression.startsWith('=')) expression = expression.slice(1).trim();
  if (!expression || expression.length > MAX_EXPRESSION_LENGTH) return '';
  if (expression.includes('**') || expression.includes('//')) return '';
  if (!/^[\d+\-*/.()\s]*$/.test(expression)) return '';
  return expression;
};

export const parseArithmeticExpression = (value, { stripHtml = false } = {}) => {
  const source = normalizedExpression(value, stripHtml);
  if (!source) return null;
  let position = 0;
  let operations = 0;

  const fail = () => { throw new Error('Espressione non valida'); };
  const skipSpaces = () => {
    while (position < source.length && /\s/.test(source[position])) position += 1;
  };
  const checked = (number) => {
    operations += 1;
    if (operations > MAX_OPERATIONS || !Number.isFinite(number)) fail();
    return number;
  };
  const parseNumber = () => {
    skipSpaces();
    const match = source.slice(position).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) fail();
    position += match[0].length;
    return checked(Number(match[0]));
  };
  const parseExpression = (depth = 0) => {
    if (depth > MAX_DEPTH) fail();
    const parseFactor = () => {
      skipSpaces();
      if (source[position] === '+' || source[position] === '-') {
        const sign = source[position];
        position += 1;
        const operand = parseFactor();
        return checked(sign === '-' ? -operand : operand);
      }
      if (source[position] === '(') {
        position += 1;
        const value = parseExpression(depth + 1);
        skipSpaces();
        if (source[position] !== ')') fail();
        position += 1;
        return value;
      }
      return parseNumber();
    };
    const parseTerm = () => {
      let value = parseFactor();
      while (true) {
        skipSpaces();
        const operator = source[position];
        if (operator !== '*' && operator !== '/') break;
        position += 1;
        const right = parseFactor();
        if (operator === '/' && right === 0) fail();
        value = checked(operator === '*' ? value * right : value / right);
      }
      return value;
    };
    let value = parseTerm();
    while (true) {
      skipSpaces();
      const operator = source[position];
      if (operator !== '+' && operator !== '-') break;
      position += 1;
      const right = parseTerm();
      value = checked(operator === '+' ? value + right : value - right);
    }
    return value;
  };

  try {
    const result = parseExpression();
    skipSpaces();
    if (position !== source.length) return null;
    return { expression: source, value: result };
  } catch {
    return null;
  }
};

export const safeArithmeticValue = (
  value,
  { formulaOnly = false, stripHtml = false } = {},
) => {
  if (value === '' || value === null || value === undefined) return 0;
  const raw = String(value).trim();
  if (formulaOnly && !raw.startsWith('=')) {
    const plain = Number.parseFloat(raw.replace(/,/g, '.'));
    return Number.isFinite(plain) ? plain : 0;
  }
  return parseArithmeticExpression(value, { stripHtml })?.value ?? 0;
};
