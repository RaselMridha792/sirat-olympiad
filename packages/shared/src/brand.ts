/**
 * The programme's public name, per language: the ONE source for the web (apps/web/src/content/site.ts reads it) and
 * for the API's PDFs (the admit card, then the certificates), so a print never differs from the site. Still to
 * confirm with the client (the brand-name decision is open); a change here changes both.
 */
export const SITE_NAME = {
  bn: 'ইন্টারন্যাশনাল সিরাত অলিম্পিয়াড ৩.০',
  en: 'International Sirat Olympiad 3.0',
} as const;
