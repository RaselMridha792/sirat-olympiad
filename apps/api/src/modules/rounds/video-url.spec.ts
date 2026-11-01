import { isAllowedVideoUrl } from '@sirat/shared';

describe('isAllowedVideoUrl (core C6b; Q4b default: YouTube and Google Drive, https only)', () => {
  it.each([
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/shorts/abc123',
    'https://m.youtube.com/watch?v=abc',
    'https://drive.google.com/file/d/1AbC/view?usp=sharing',
    'https://YouTu.be/abc',
    'https://youtu.be',
  ])('accepts %s', (url) => {
    expect(isAllowedVideoUrl(url)).toBe(true);
  });

  it.each([
    ['http, not https', 'http://youtu.be/abc'],
    ['another host', 'https://vimeo.com/123'],
    ['a look-alike host', 'https://youtube.com.evil.example/watch'],
    ['a host ending like an allowed one', 'https://notyoutube.com/watch'],
    ['a user name before the host', 'https://youtu.be@evil.example/abc'],
    ['a user and password', 'https://user:pass@youtu.be/abc'],
    ['a port', 'https://youtu.be:8443/abc'],
    ['a backslash trick', 'https://youtu.be\\@evil.example/'],
    ['a space', 'https://youtu.be/a b'],
    ['javascript', 'javascript:alert(1)'],
    ['no scheme', 'youtu.be/abc'],
    ['a protocol-relative link', '//youtu.be/abc'],
    ['empty', ''],
    ['too long', `https://youtu.be/${'a'.repeat(500)}`],
  ])('refuses %s', (_why, url) => {
    expect(isAllowedVideoUrl(url)).toBe(false);
  });
});
