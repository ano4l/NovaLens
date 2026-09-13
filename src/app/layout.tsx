import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
export const metadata: Metadata = { title: "NovaLens Operations", description: "Automotive catalogue recognition and review" };
const nav = [
  ["/", "Overview", "M4 5h16v14H4zM4 10h16M9 10v9"],
  ["/upload", "New batch", "M12 16V4m-4 4-4 4M5 15v4h14v-4"],
  ["/training", "Training", "M5 4h14v16H5zM8 8h8M8 12h5"],
  ["/admin", "Settings", "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 12h2M3 12h2M12 3V1M12 23v-2"],
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  return <html lang="en" className={`${geist.variable} ${geistMono.variable}`}><body><div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand-mark"><span className="brand-symbol">N</span><span>NovaLens<small>Operations</small></span></Link>
      <nav aria-label="Primary navigation">{nav.map(([href, label, path]) => <Link href={href} key={href} className="nav-link"><svg aria-hidden="true" viewBox="0 0 24 24"><path d={path} /></svg>{label}</Link>)}</nav>
      <div className="provider-status"><span><i className={geminiConfigured ? "" : "mock"} />{geminiConfigured ? "Recognition online" : "Recognition demo"}</span><strong>{geminiConfigured ? "Google AI" : "Mock provider"}</strong><small>{geminiConfigured ? "Gemini 2.5 models" : "Add GEMINI_API_KEY"}</small></div>
    </aside>
    <div className="app-column">
      <header className="mobile-header"><Link href="/" className="brand-mark"><span className="brand-symbol">N</span><span>NovaLens</span></Link><span>Operations console</span></header>
      <nav className="mobile-nav" aria-label="Primary mobile navigation">{nav.map(([href, label]) => <Link href={href} key={href}>{label}</Link>)}</nav>
      <main>{children}</main>
    </div>
  </div></body></html>;
}
