import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Legal Document Creator | prelegal",
  description: "Create Common Paper standard legal agreements by chatting with an AI assistant, and download them as PDFs.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full font-sans antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <footer className="border-t border-stone-200 px-4 py-6 text-center text-xs leading-relaxed text-stone-500">
          prelegal is not a law firm and does not give legal advice. Documents are based on the{" "}
          <a href="https://commonpaper.com/standards/" target="_blank" rel="noreferrer" className="underline">
            Common Paper standard agreements
          </a>{" "}
          (CC BY 4.0). Review them with a lawyer before signing.
        </footer>
      </body>
    </html>
  );
}
