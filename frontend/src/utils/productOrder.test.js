import {
  compareProductsByCanonicalOrder,
  sortByCanonicalOrder,
} from './productOrder';

describe('ordine canonico prodotti magazzino', () => {
  test.each([
    'RAGU DI CINGHIALE',
    'RAGÙ DI CINGHIALE',
    'CINGHIALE',
  ])('%s resta tra pomodori secchi e pesto di pistacchi', (wildBoarRagu) => {
    const products = [
      { name: 'PESTO DI PISTACCHI' },
      { name: wildBoarRagu },
      { name: 'POMODORI SECCHI' },
    ].sort(compareProductsByCanonicalOrder);

    expect(products.map(product => product.name)).toEqual([
      'POMODORI SECCHI',
      wildBoarRagu,
      'PESTO DI PISTACCHI',
    ]);
  });

  test('applica lo stesso ordine anche agli articoli salvati nei DDT', () => {
    const items = [
      { product_name: 'PESTO DI PISTACCHI' },
      { product_name: 'RAGU DI CINGHIALE' },
      { product_name: 'POM SECCHI' },
    ];

    expect(sortByCanonicalOrder(items, item => item.product_name)).toEqual([
      items[2],
      items[1],
      items[0],
    ]);
  });
});
