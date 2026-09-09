import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "NovaLens | Auto Spares Tagging",
  description: "AI-powered bulk auto spares inventory tagging",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <div className="min-h-[100dvh] flex flex-col">
          <header className="app-header">
            <div className="max-w-[1480px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-3 sm:gap-7">
              <Link href="/" className="brand-mark" aria-label="NovaLens home">
                <span className="brand-symbol" aria-hidden="true">N</span>
                <span>NovaLens</span>
              </Link>
              <nav className="flex items-center gap-1 text-sm text-zinc-400" aria-label="Primary navigation">
                <Link href="/" className="nav-link">
                  Shipments
                </Link>
                <Link href="/upload" className="nav-link">
                  New Upload
                </Link>
                <Link href="/admin" className="nav-link">
                  Admin
                </Link>
              </nav>
              <div className="ml-auto hidden sm:flex items-center gap-2 text-xs text-zinc-500">
                Operations console
              </div>
            </div>
          </header>
          <main className="flex-1 max-w-[1480px] w-full mx-auto px-4 sm:px-6 py-7 sm:py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
