import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif, MuseoModerno } from "next/font/google";
import "./globals.css";
import "./cliniq-theme.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const cliniqDisplay = MuseoModerno({ variable: "--font-cliniq-display", subsets: ["latin"], weight: ["200", "600", "700"] });
const cliniqSerif = Instrument_Serif({ variable: "--font-cliniq-serif", subsets: ["latin"], weight: "400", style: "italic" });

export const metadata: Metadata = {
  title: { default: "Cliniq Team", template: "%s · Cliniq Team" },
  description: "Rooster, beschikbaarheid en diensten voor het team van Cliniq.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Cliniq", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#31071B" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="nl"><body className={`${geistSans.variable} ${geistMono.variable} ${cliniqDisplay.variable} ${cliniqSerif.variable}`}>{children}</body></html>;
}
