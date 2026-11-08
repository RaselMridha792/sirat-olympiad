/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // required: runs in a container behind Nginx, NOT on Vercel
  transpilePackages: ['@sirat/ui'],
  poweredByHeader: false,
  compress: false, // Nginx compresses (RULEBOOK §11); never gzip inside Node
  reactStrictMode: true,
  async headers() {
    // Anti-framing for every page (clickjacking). Set here rather than in nginx, where a location with its own
    // add_header would silently drop server-level headers.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  async redirects() {
    // The public pages were Bangla under /bn until 2026-11-03 (core plan D4 now: Bangla at /, English under /en).
    // Old links land on the same page. Temporary, so no browser caches it for good.
    return [
      { source: '/bn', destination: '/', permanent: false },
      { source: '/bn/:path*', destination: '/:path*', permanent: false },
    ];
  },
  async rewrites() {
    // Dev only: in production Nginx routes /api/* to NestJS on the same origin. API_INTERNAL_URL lets a session that
    // runs its own API on another port (RUNBOOK §0, parallel sessions) point its dev web at it.
    if (process.env.NODE_ENV === 'production') return [];
    const api = (process.env.API_INTERNAL_URL?.trim() || 'http://localhost:4000').replace(
      /\/+$/,
      '',
    );
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};
export default nextConfig;
