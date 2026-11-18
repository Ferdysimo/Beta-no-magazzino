import { parseVersSegments, sanitizeVersHtml, versHasMixedColors } from './versHtml';


describe('versHtml', () => {
  test('mantiene numeri e colori usati dal Report', () => {
    const raw = '<span style="color: rgb(220, 38, 38)">50</span>+30';
    expect(parseVersSegments(raw)).toEqual({
      segments: [
        { text: '50', red: true },
        { text: '+30', red: false },
      ],
      mixed: true,
    });
    expect(versHasMixedColors(raw)).toBe(true);
  });

  test('elimina tag, attributi evento e stili non ammessi', () => {
    window.__versPwned = 0;
    const raw = [
      '<img src="x" onerror="window.__versPwned=1">',
      '<span onclick="window.__versPwned=2" style="color:red;background:url(x)">50</span>',
      '<script>window.__versPwned=3</script>',
      '<span style="color:blue">+30</span>',
    ].join('');

    const clean = sanitizeVersHtml(raw);

    expect(window.__versPwned).toBe(0);
    expect(clean).not.toMatch(/img|script|onerror|onclick|background|blue/i);
    expect(clean).toContain('<span style="color: rgb(220, 38, 38);">50</span>');
    expect(parseVersSegments(clean).segments).toEqual([
      { text: '50', red: true },
      { text: '+30', red: false },
    ]);
  });
});
