import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-bengali'; // Bangla text (self-hosted, no Google Fonts call)
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Sirat Leadership Olympiad', template: '%s | Sirat Leadership Olympiad' },
  description: 'Online leadership olympiad for students.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
