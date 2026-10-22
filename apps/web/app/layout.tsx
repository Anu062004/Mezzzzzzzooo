import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')),
  title: 'MezoLoop — Payments. Shared value.',
  description: 'One payment. More possibility. Explore non-custodial payments, merchant referrals, and customer cashback on Mezo.',
  openGraph: { title: 'MezoLoop — Payments. Shared value.', description: 'A better kind of payment loop.', images: ['/brand/mezoloop-cover.png'] },
  icons: { icon: '/brand/mezoloop-logo.png' },
};
export default function Layout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
