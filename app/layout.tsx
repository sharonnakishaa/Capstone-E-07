import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'EPEN — Monitoring Kualitas Udara',
  description: 'Sistem monitoring kualitas udara Lab DTETI berbasis IoT',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}
