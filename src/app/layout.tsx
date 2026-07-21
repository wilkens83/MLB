import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Diamond Edge — MLB Player Props Analytics",
  description:
    "Model every MLB player prop with live data, Monte Carlo simulation, hit-rate history, and positive-EV betting signals.",
  keywords: ["MLB", "player props", "betting", "analytics", "Monte Carlo", "expected value"],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <div className="app-aurora" aria-hidden />
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
