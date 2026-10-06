import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Nav from "@/components/nav";
import Footer from "@/components/footer";

/**
 * Season Mix / Season Sans (the goldsand.fi pairing) are commercial fonts from
 * Displaay. These are the free stand-ins. To swap in the real thing later,
 * drop the .woff2 files in ./fonts and change the two src paths below —
 * every consumer reads the CSS variables, so nothing else moves.
 */
/**
 * next/font names the generated @font-face family after the variable these are
 * assigned to. `display`, `sans` and `mono` are CSS generic keywords, so a
 * family called `sans` is parsed as the keyword and the loaded face is ignored
 * — headings silently fell back to Arial. The tenderFoo- prefix keeps the
 * generated family names unambiguous.
 */
const tenderDisplay = localFont({
  src: "./fonts/Fraunces-400.woff2",
  variable: "--font-instrument-serif",
  display: "swap",
  weight: "400",
});

const tenderSans = localFont({
  src: "./fonts/InstrumentSans-Variable.woff2",
  variable: "--font-general-sans",
  display: "swap",
  weight: "400 700",
});

/** The mono face. Used for section eyebrows, stat labels and the dark
 *  sections' prose. */
const tenderMono = localFont({
  src: "./fonts/JetBrainsMono-400.woff2",
  variable: "--font-mono-ui",
  display: "swap",
  weight: "400",
});

// Canonical origin for links, social cards and sitemaps. APP_URL is set per
// deployment; the fallback is the real domain, never a guess.
const SITE = (process.env.APP_URL ?? "https://tenderr.xyz").replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Tender · Get paid in any coin. Settle on Monad.",
  description:
    "Your customer pays with whatever they already hold, even the Bitcoin they swore they'd never sell. You receive one asset on Monad. No bridges, no network switching, and no MON to hold.",
  openGraph: {
    title: "Tender · Get paid in any coin. Settle on Monad.",
    description:
      "Any-chain crypto checkout. 30 chains in, one asset out, non-custodial.",
    url: SITE,
    siteName: "Tender",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tender · Get paid in any coin. Settle on Monad.",
    description:
      "Any-chain crypto checkout. 30 chains in, one asset out, non-custodial.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${tenderDisplay.variable} ${tenderSans.variable} ${tenderMono.variable}`}
    >
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-ink focus:px-5 focus:py-2.5 focus:text-sm focus:text-paper"
        >
          Skip to content
        </a>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
