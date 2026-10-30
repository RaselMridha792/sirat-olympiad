import { emailHash, ipKey } from './login-limiter';

describe('login limiter keys', () => {
  it('identifies an account by a hash of its normalized email, never the email itself', () => {
    const h = emailHash('Student@Example.com ');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(emailHash('student@example.com')).toBe(h);
    expect(emailHash('other@example.com')).not.toBe(h);
    expect(h).not.toContain('student');
  });

  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:0db8:0001:0002::/64'],
    ['2001:db8:1:2::9', '2001:0db8:0001:0002::/64'],
    ['2001:DB8:1:2:ffff::1', '2001:0db8:0001:0002::/64'],
    ['::1', '0000:0000:0000:0000::/64'],
    ['64:ff9b::192.0.2.33', '0064:ff9b:0000:0000::/64'],
    ['not-an-ip', 'unknown'],
    [undefined, 'unknown'],
  ])('keys %s as %s', (ip, key) => {
    expect(ipKey(ip)).toBe(key);
  });

  it('puts different /64 networks apart', () => {
    expect(ipKey('2001:db8:1:3::1')).not.toBe(ipKey('2001:db8:1:2::1'));
  });
});
