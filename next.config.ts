import type { NextConfig } from 'next';

const config: NextConfig = {
  distDir: process.env.ODIN_NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ]}, { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] }];
  },
};
export default config;
