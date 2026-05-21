import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Sans_Arabic, JetBrains_Mono } from "next/font/google";
import { getLang } from "@/lib/cookies";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Yarmouk Study",
  description:
    "Evaluating the 1987 Agreement between Jordan and Syria concerning the utilization of the Yarmouk River",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Drive document language/direction off the respondent's lang cookie
  // (a11y #8). getLang() returns 'en' by default, so the English-only
  // admin section and any no-cookie visitor render lang="en"/dir="ltr".
  const lang = await getLang();
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <body
        className={`${plusJakartaSans.variable} ${ibmPlexArabic.variable} ${jetBrainsMono.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
