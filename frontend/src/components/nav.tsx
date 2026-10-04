"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { nav } from "@/lib/copy";
import Button from "./button";
import { TenderMark } from "./logo";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock the page behind the mobile sheet.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled || open
          ? "border-b border-line bg-paper/85 backdrop-blur-md"
          : "border-b border-transparent"
      }`}
    >
      <div className="shell flex h-[62px] items-center justify-between gap-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-[1.4rem] leading-none tracking-[-0.03em]"
        >
          <TenderMark className="h-[1.375rem] w-[1.375rem] text-ink" />
          Tender
        </Link>

        {/* Centred links and the button pair only fit side by side past ~900px;
            below that the hamburger carries everything. */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 lg:flex">
          {nav.links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-[0.9375rem] text-mute transition-colors duration-200 hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 lg:flex">
          <Button href={nav.ghost.href} variant="ghost">
            {nav.ghost.label}
          </Button>
          <Button href={nav.primary.href}>{nav.primary.label}</Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-line lg:hidden"
        >
          <span className="relative block h-3 w-4">
            <span
              className={`absolute left-0 block h-px w-4 bg-ink transition-transform duration-300 ${
                open ? "top-1.5 rotate-45" : "top-0"
              }`}
            />
            <span
              className={`absolute left-0 block h-px w-4 bg-ink transition-transform duration-300 ${
                open ? "top-1.5 -rotate-45" : "top-3"
              }`}
            />
          </span>
        </button>
      </div>

      {open && (
        <div className="border-t border-line bg-paper lg:hidden">
          <div className="shell flex flex-col gap-1 py-6">
            {nav.links.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-line py-3.5 text-lg"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-5 flex flex-col gap-2.5">
              <Button href={nav.ghost.href} variant="ghost">
                {nav.ghost.label}
              </Button>
              <Button href={nav.primary.href}>{nav.primary.label}</Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
