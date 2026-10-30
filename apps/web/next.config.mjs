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
  async rewrites() {
    // Dev only: in production Nginx routes /api/* to NestJS on the same origin.
    if (process.env.NODE_ENV === 'production') return [];
    return [{ source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' }];
  },
};
export default nextConfig;
