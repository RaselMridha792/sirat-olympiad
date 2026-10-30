/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // required: runs in a container behind Nginx, NOT on Vercel
  transpilePackages: ['@sirat/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    // Dev only: in production Nginx routes /api/* to NestJS on the same origin.
    if (process.env.NODE_ENV === 'production') return [];
    return [{ source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' }];
  },
};
export default nextConfig;
