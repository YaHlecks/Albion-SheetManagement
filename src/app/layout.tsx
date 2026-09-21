import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import "../styles/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "Albion Event Sheets — Mass Scheduling & Sign-ups",
    template: "%s · Albion Event Sheets",
  },
  description:
    "Event scheduling and mass sign-ups for Albion Online guilds: parties, builds, member self-registration, notifications and admin oversight.",
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
