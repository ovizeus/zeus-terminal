const { validateProfileFields } = require('../../server/middleware/validate');

test('accepts a clean profile', () => {
  expect(validateProfileFields({ display_name: 'Ovi', username: 'zeus_ovi', accent_color: '#f0c040', tagline: 'hi', avatar: 'data:image/png;base64,iVBORw0KGgo=' }).ok).toBe(true);
});
test('rejects bad username chars', () => { expect(validateProfileFields({ username: 'ov i!' }).ok).toBe(false); });
test('rejects too-short username', () => { expect(validateProfileFields({ username: 'ab' }).ok).toBe(false); });
test('rejects oversize avatar', () => { expect(validateProfileFields({ avatar: 'data:image/png;base64,' + 'A'.repeat(400000) }).ok).toBe(false); });
test('rejects non-image avatar data uri', () => { expect(validateProfileFields({ avatar: 'data:text/html;base64,AAA' }).ok).toBe(false); });
test('rejects bad accent color', () => { expect(validateProfileFields({ accent_color: 'red; drop' }).ok).toBe(false); });
test('rejects too-long display_name', () => { expect(validateProfileFields({ display_name: 'x'.repeat(50) }).ok).toBe(false); });
