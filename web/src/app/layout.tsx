import type { Metadata } from "next";
import { Fraunces, Inter_Tight } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import NavProgress from "@/components/NavProgress";
import { ConfirmProvider } from "@/components/ConfirmDialog";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "900"],
  style: ["normal", "italic"],
  display: "swap",
});

const body = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TTNAWA — Tamil Nadu Arm Wrestling Association",
  description:
    "Tamil Nadu State Championship — online registration, weigh-in and fixtures.",
  openGraph: {
    title: "TTNAWA — Tamil Nadu Arm Wrestling Association",
    description:
      "Tamil Nadu State Championship — online registration, weigh-in and fixtures.",
    images: ["/brand/logo.jpg"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="font-sans antialiased">
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <ConfirmProvider>{children}</ConfirmProvider>
      </body>
    </html>
  );
}

