import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "NightProfit — Profit control for nightlife", template: "%s · NightProfit" },
  description: "Evidence-backed financial control for bars, clubs and event venues.",
  openGraph: { title: "NightProfit", description: "Zie waar je winst verdwijnt. Vóór je volgende opening.", images: ["/og.png"] },
  twitter: { card: "summary_large_image", title: "NightProfit", description: "Evidence-backed profit control.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="nl"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
