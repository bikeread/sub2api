import type { Metadata } from 'next';
import { IBM_Plex_Sans, Syne } from 'next/font/google';

import '@/app/globals.css';

const display = Syne({
  subsets: ['latin'],
  variable: '--font-display',
});

const body = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'API Key Board',
  description: 'Team-facing API key wallboard for Sub2API deployments',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
