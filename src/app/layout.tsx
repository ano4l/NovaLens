import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "NovaLens — Auto Spares Tagging",
  description: "AI-powered bulk auto spares inventory tagging",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-zinc-800 bg-zinc-900/60 sticky top-0 z-10 backdrop-blur">
            <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
              <Link href="/" className="font-bold text-lg tracking-tight">
                Nova<span className="text-amber-400">Lens</span>
              </Link>
              <nav className="flex gap-4 text-sm text-zinc-400">
                <Link href="/" className="hover:text-zinc-100">
                  Shipments
                </Link>
                <Link href="/upload" className="hover:text-zinc-100">
                  New Upload
                </Link>
                <Link href="/admin" className="hover:text-zinc-100">
                  Admin
                </Link>
              </nav>
            </div>
          </header>
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
