import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recepto",
  description: "AI receptionists that answer, remember, and book."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
