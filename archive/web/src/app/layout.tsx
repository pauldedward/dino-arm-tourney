import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dino Arm Tourney — Tamil Nadu arm wrestling registration",
  description:
    "Online registration, weigh-in and bracket tooling for Tamil Nadu arm wrestling championships.",
  metadataBase: new URL("https://dino-arm-tourney.local"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
