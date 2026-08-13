import type { Metadata } from "next";
import { Space_Grotesk, Geist_Mono, UnifrakturCook } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const gothic = UnifrakturCook({
  variable: "--font-gothic",
  weight: "700",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lithos Terminal",
  description: "Quantitative gem market intelligence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${geistMono.variable} ${gothic.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
