import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import "../styles/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "Albion Team Sheets — Team Sheet Management",
    template: "%s · Albion Team Sheets",
  },
  description:
    "Controlled team sheets, approved members, activity tracking and administrator moderation for Albion Online guilds.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0c10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
