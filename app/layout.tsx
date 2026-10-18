import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif, MuseoModerno } from "next/font/google";
import "./globals.css";
import "./cliniq-theme.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const cliniqDisplay = MuseoModerno({ variable: "--font-cliniq-display", subsets: ["latin"], weight: ["200", "600", "700"] });
const cliniqSerif = Instrument_Serif({ variable: "--font-cliniq-serif", subsets: ["latin"], weight: "400", style: "italic" });

export const metadata: Metadata = {
  title: { default: "Cliniq · Rooster", template: "%s · Cliniq" },
  description: "Evidence-backed financial control for bars, clubs and event venues.",
  openGraph: { title: "NightProfit", description: "Zie waar je winst verdwijnt. Vóór je volgende opening.", images: ["/og.png"] },
  twitter: { card: "summary_large_image", title: "NightProfit", description: "Evidence-backed profit control.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="nl"><body className={`${geistSans.variable} ${geistMono.variable} ${cliniqDisplay.variable} ${cliniqSerif.variable}`}>{children}</body></html>;
}
