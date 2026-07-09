import type { Metadata } from "next";
import { Sora, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import { NoContextMenu } from "./no-context-menu";

const sora = Sora({ subsets: ["latin"], variable: "--font-body" });
const splineMono = Spline_Sans_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Time Tracker",
  description: "Simple day-wise task time tracking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sora.variable} ${splineMono.variable}`}>
        <NoContextMenu />
        {children}
      </body>
    </html>
  );
}
