/** @type {import('next').NextConfig} */
const config = {
  output: process.env.STATIC_EXPORT === '1' ? 'export' : undefined,
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    if (process.env.STATIC_EXPORT === '1') return [];
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }];
  },
};
export default config;
