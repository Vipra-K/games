import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tag Arena",
  description: "Real-time multiplayer tag with friends.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
