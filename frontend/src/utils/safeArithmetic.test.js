import { parseArithmeticExpression, safeArithmeticValue } from './safeArithmetic';


describe('safeArithmetic', () => {
  test('mantiene le formule supportate dal Report', () => {
    expect(safeArithmeticValue('10+5*2')).toBe(20);
    expect(safeArithmeticValue('=(10,50 + 3,20) / 2')).toBeCloseTo(6.85);
    expect(safeArithmeticValue('-5 + +2')).toBe(-3);
    expect(safeArithmeticValue('<span style="color:red">50</span>+30', { stripHtml: true })).toBe(80);
  });

  test('rifiuta potenze, divisione intera e formule eccessive', () => {
    expect(parseArithmeticExpression('9**9**9')).toBeNull();
    expect(safeArithmeticValue('10//2')).toBe(0);
    expect(safeArithmeticValue(`${'1+'.repeat(101)}1`)).toBe(0);
    expect(safeArithmeticValue('1/0')).toBe(0);
  });

  test('con formulaOnly conserva il comportamento storico dei valori semplici', () => {
    expect(safeArithmeticValue('12 pezzi', { formulaOnly: true })).toBe(12);
    expect(safeArithmeticValue('=10+5', { formulaOnly: true })).toBe(15);
  });
});
