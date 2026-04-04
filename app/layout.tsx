import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kairis",
  description: "Disciplined non-custodial crypto trading workflows."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
