"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TenderMark } from "@/components/logo";
import { SignOutForm } from "@/components/auth/sign-out";
import CurrencyFlag from "@/components/dash/currency-flag";
import { currencyMeta, useCurrency } from "@/components/dash/currency";
import { SoonTag } from "@/components/dash/coming-soon";
import {
  CloseIcon,
  MenuIcon,
  SettingsIcon,
} from "@/components/dash/icons";
import {
  DISPLAY_CURRENCIES,
  NAV,
  isActive,
  type NavItem,
} from "@/lib/dash-nav";
import {
  DropdownChevron,
  DropdownItem,
  DropdownPanel,
} from "@/components/ui/animated-dropdown";
import { GlowRail, GlowTab } from "@/components/ui/glow-menu";
import { recordPath } from "@/lib/nav-history";
import { useAsk } from "@/components/ask/ask-provider";
import { Mascot } from "@/components/ask/mascot";

/**
 * The dashboard header.
 *
 * Three popovers live here — the Pay dropdown, the currency picker and the
 * avatar menu — and they share one piece of machinery (`useDismiss`) rather
 * than each growing their own listeners. All three close on Escape, on an
 * outside click, and on navigation. They also share one motion with the form
 * selects, from `components/ui/animated-dropdown`.
 *
 * The header is one component instead of three because the popovers are
 * mutually exclusive: opening one must close the others, which is far simpler
 * to guarantee from a single piece of state than by coordinating siblings.
 */

type Session = {
  name: string;
  email: string;
  picture?: string;
};

/** Which popover is open. Exactly one at a time, or none. */
type Open = null | "pay" | "currency" | "avatar";

export default function DashNav({ session }: { session: Session }) {
  const pathname = usePathname();
  const ask = useAsk();
  const [open, setOpen] = useState<Open>(null);
  const [mobile, setMobile] = useState(false);
  // The display currency is presentation only (see components/dash/currency.tsx):
  // it never changes where money settles. Codes without a live rate stay
  // listed but disabled, so a currency is only offered when it can be shown truly.
  const { code: currencyCode, setCode: setCurrencyCode, available, asOf } = useCurrency();
  const currency = currencyMeta(currencyCode);
  const headerRef = useRef<HTMLElement>(null);

  // Any navigation dismisses everything. Without this a dropdown stays open
  // over the new page, because the click that navigated never left the header.
  useEffect(() => {
    setOpen(null);
    setMobile(false);
    // The header is mounted on every dashboard screen and outlives them all,
    // which makes it the one place that sees every move — see nav-history.
    recordPath(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!open && !mobile) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(null);
        setMobile(false);
      }
    }
    function onPointer(event: PointerEvent) {
      // Only the desktop popovers close on an outside click. The mobile sheet
      // covers the screen and has its own backdrop, so the same handler would
      // shut it on the very tap that opened it.
      if (!headerRef.current?.contains(event.target as Node)) setOpen(null);
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, mobile]);

  // The sheet scrolls itself; the page behind it must not.
  useEffect(() => {
    if (!mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobile]);

  function toggle(which: Exclude<Open, null>) {
    setOpen((current) => (current === which ? null : which));
  }

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-50 border-b border-line bg-paper/90 backdrop-blur-md"
    >
      <div className="mx-auto flex h-[3.875rem] w-full max-w-[76rem] items-center gap-2 px-4 md:border-x md:border-line md:px-6">
        {/* Mark + beta chip */}
        <Link
          href="/app/home"
          className="flex shrink-0 items-center gap-2 rounded-lg py-1 pr-1"
          aria-label="Tender dashboard home"
        >
          <TenderMark className="h-[1.375rem] w-[1.375rem] text-ink" />
          {/* Wordmark and chip stand down between md and xl: that is exactly
              the range where the tab rail needs the width, and the mark alone
              still identifies the page. Both return once there is room. */}
          <span className="hidden font-display text-[1.25rem] leading-none sm:block md:hidden xl:block">
            tender
          </span>
          <span className="ml-0.5 hidden rounded-full border border-line px-1.5 py-[0.1875rem] font-mono text-[0.5625rem] uppercase leading-none tracking-[0.12em] text-mute sm:inline-block md:hidden xl:inline-block">
            Beta
          </span>
        </Link>

        {/* Tab rail. Shown from md, where the tabs run at their tighter size
            and the wordmark steps aside, which is what lets seven of them plus
            the right-hand controls fit a ~853px viewport — a 1280×720 screen
            at 150% OS scaling. Below md the sheet takes over. */}
        <GlowRail label="Dashboard" className="mx-auto hidden md:block">
            {NAV.map((item) =>
              item.children ? (
                <li key={item.href} className="relative">
                  <GlowTab
                    icon={item.icon}
                    label={item.label}
                    short={item.short}
                    active={isActive(pathname, item.href) || open === "pay"}
                    onClick={() => toggle("pay")}
                    expanded={open === "pay"}
                    trailing={
                      <DropdownChevron open={open === "pay"} className="h-3 w-3" />
                    }
                  />
                  <PayMenu
                    item={item}
                    pathname={pathname}
                    open={open === "pay"}
                  />
                </li>
              ) : (
                <li key={item.href}>
                  <GlowTab
                    icon={item.icon}
                    label={item.label}
                    short={item.short}
                    href={item.href}
                    active={isActive(pathname, item.href)}
                    trailing={item.soon ? <SoonTag className="hidden xl:inline-block" /> : undefined}
                  />
                </li>
              ),
            )}
        </GlowRail>

        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          {/* Ask — opens the assistant over this screen; no navigation. */}
          <button
            type="button"
            onClick={ask.open}
            aria-label="Ask about your payments"
            aria-haspopup="dialog"
            className={`hidden h-9 w-9 items-center justify-center rounded-full border transition-colors sm:flex ${
              isActive(pathname, "/app/ask") || ask.isOpen
                ? "border-sand bg-sand/10"
                : "border-line hover:bg-stone"
            }`}
          >
            <Mascot className="h-[1.375rem] w-[1.375rem]" />
          </button>

          {/* Display currency */}
          <div className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => toggle("currency")}
              aria-expanded={open === "currency"}
              aria-haspopup="listbox"
              aria-label={`Display currency: ${currency.label}`}
              className="flex h-9 items-center gap-1.5 rounded-full border border-line pl-1 pr-2 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink transition-colors hover:bg-stone xl:pl-1.5 xl:pr-3"
            >
              <CurrencyFlag code={currency.code} className="h-5 w-5 xl:h-6 xl:w-6" />
              {currency.code}
              {/* The symbol is redundant beside the code, so it is the first
                  thing to go once the rail is sharing this row. It comes back
                  at xl, where there is width for both. */}
              <span className="hidden xl:inline">
                {" "}
                · {currency.symbol}
              </span>
              <DropdownChevron
                open={open === "currency"}
                className="h-3.5 w-3.5 text-mute"
              />
            </button>
            <DropdownPanel
              open={open === "currency"}
              role="listbox"
              label="Display currency"
              className="no-scrollbar absolute right-0 top-[calc(100%+0.5rem)] max-h-[21rem] w-[15rem] overflow-y-auto overscroll-contain"
            >
              <DropdownItem>
                <p className="px-2.5 pb-1 pt-2 font-mono text-[0.5625rem] uppercase tracking-[0.16em] text-mute">
                  Display currency
                </p>
                <p className="px-2.5 pb-2 text-[0.6875rem] leading-snug text-mute">
                  Dollar amounts are shown in the currency you pick, at a daily reference
                  rate{asOf ? ` (published ${new Date(asOf).toISOString().slice(0, 10)})` : ""}. Where
                  your money settles does not change.
                </p>
              </DropdownItem>
              {DISPLAY_CURRENCIES.map((item) => (
                <DropdownItem key={item.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.code === currency.code}
                    aria-disabled={!available.has(item.code)}
                    disabled={!available.has(item.code)}
                    onClick={() => {
                      setCurrencyCode(item.code);
                      setOpen(null);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[0.8125rem] transition-colors disabled:cursor-not-allowed ${
                      item.code === currency.code
                        ? "bg-stone text-ink"
                        : available.has(item.code)
                          ? "text-ink hover:bg-stone/60"
                          : "text-mute"
                    }`}
                  >
                    <CurrencyFlag
                      code={item.code}
                      className={`h-5 w-5 ${item.code === currency.code ? "" : "opacity-70"}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="font-mono text-[0.6875rem] text-mute">
                      {available.has(item.code) ? item.code : "Soon"}
                    </span>
                  </button>
                </DropdownItem>
              ))}
            </DropdownPanel>
          </div>

          {/* Avatar */}
          <div className="relative">
            <button
              type="button"
              onClick={() => toggle("avatar")}
              aria-expanded={open === "avatar"}
              aria-haspopup="menu"
              aria-label="Account menu"
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-line bg-stone transition-colors hover:border-ink/25"
            >
              <Avatar session={session} />
            </button>
            <AvatarMenu session={session} open={open === "avatar"} />
          </div>

          {/* Mobile trigger */}
          <button
            type="button"
            onClick={() => setMobile(true)}
            aria-label="Open menu"
            aria-expanded={mobile}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-stone md:hidden"
          >
            <MenuIcon className="h-[1.125rem] w-[1.125rem]" />
          </button>
        </div>
      </div>

      {mobile && (
        <MobileSheet
          pathname={pathname}
          session={session}
          onClose={() => setMobile(false)}
          onAsk={() => {
            setMobile(false);
            ask.open();
          }}
        />
      )}
    </header>
  );
}

/* -------------------------------------------------------------------------- */

/** Each row carries a one-line description: these three verbs are close enough
 *  that a bare label leaves a merchant guessing which one they want. */
function PayMenu({
  item,
  pathname,
  open,
}: {
  item: NavItem;
  pathname: string;
  open: boolean;
}) {
  return (
    <DropdownPanel
      open={open}
      role="menu"
      className="absolute left-1/2 top-[calc(100%+0.5rem)] w-[17.5rem] -translate-x-1/2"
    >
      {item.children?.map((child) => (
        <DropdownItem key={child.href}>
          <Link
            href={child.href}
            role="menuitem"
            className={`block rounded-xl px-3 py-2.5 transition-colors ${
              isActive(pathname, child.href) ? "bg-stone" : "hover:bg-stone"
            }`}
          >
            <span className="block text-[0.875rem] text-ink">{child.label}</span>
            <span className="mt-0.5 block text-[0.75rem] leading-snug text-mute">
              {child.desc}
            </span>
          </Link>
        </DropdownItem>
      ))}
    </DropdownPanel>
  );
}

function Avatar({ session }: { session: Session }) {
  if (session.picture) {
    // Deliberately a plain <img>: the source is Google's CDN, which would
    // otherwise need a next.config remote-pattern entry, and a 36px avatar
    // gains nothing from the optimizer.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={session.picture}
        alt=""
        className="h-full w-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span className="font-mono text-[0.75rem] uppercase text-ink">
      {session.name.charAt(0) || "T"}
    </span>
  );
}

function AvatarMenu({ session, open }: { session: Session; open: boolean }) {
  return (
    <DropdownPanel
      open={open}
      role="menu"
      className="absolute right-0 top-[calc(100%+0.5rem)] w-[16rem]"
    >
      <DropdownItem className="px-3 py-2.5">
        <p className="truncate text-[0.875rem] text-ink">{session.name}</p>
        <p className="truncate text-[0.75rem] text-mute">{session.email}</p>
      </DropdownItem>
      <div className="my-1 h-px bg-line" />
      <DropdownItem>
        <Link
          href="/app/settings"
          role="menuitem"
          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[0.8125rem] text-ink transition-colors hover:bg-stone"
        >
          <SettingsIcon className="h-4 w-4 text-mute" />
          Settings
        </Link>
      </DropdownItem>
      <DropdownItem>
        <Link
          href="/app/settings/developers"
          role="menuitem"
          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[0.8125rem] text-ink transition-colors hover:bg-stone"
        >
          <span className="w-4 text-center font-mono text-[0.6875rem] text-mute">
            {"{}"}
          </span>
          Developers
        </Link>
      </DropdownItem>
      <div className="my-1 h-px bg-line" />
      {/* A real form POST, not a link: signing out changes state, and a GET
          that mutates is fetchable by anything that prefetches. It also ends
          the Privy session, which a plain form post would leave open. */}
      <DropdownItem>
        <SignOutForm
          role="menuitem"
          className="w-full rounded-xl px-3 py-2 text-left text-[0.8125rem] text-ink transition-colors hover:bg-stone"
        />
      </DropdownItem>
    </DropdownPanel>
  );
}

/* -------------------------------------------------------------------------- */

function MobileSheet({
  pathname,
  session,
  onClose,
  onAsk,
}: {
  pathname: string;
  session: Session;
  onClose: () => void;
  onAsk: () => void;
}) {
  // Portalled to <body>: the header has a backdrop-filter, which makes it the
  // containing block for fixed children, so rendered in place the sheet was
  // clipped to the header's 62px strip.
  return createPortal(
    <div className="fixed inset-0 z-[60] md:hidden">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-ink/35 backdrop-blur-[2px]"
      />
      <div className="absolute inset-y-0 right-0 flex w-[min(20rem,88vw)] flex-col overflow-y-auto bg-paper">
        <div className="flex h-[3.875rem] shrink-0 items-center justify-between border-b border-line px-4">
          <span className="eyebrow text-mute">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink"
          >
            <CloseIcon className="h-[1.125rem] w-[1.125rem]" />
          </button>
        </div>

        <nav aria-label="Dashboard" className="flex-1 p-3">
          <ul className="flex flex-col gap-0.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] transition-colors ${
                      active ? "bg-ink text-paper" : "text-ink hover:bg-stone"
                    }`}
                  >
                    <Icon className="h-[1.125rem] w-[1.125rem]" />
                    {item.label}
                    {item.soon ? <SoonTag className="ml-auto" /> : null}
                  </Link>

                  {/* Children are listed inline rather than behind another tap:
                      a sheet has the vertical room, and nesting a disclosure
                      inside a drawer is two taps to reach a leaf. */}
                  {item.children && (
                    <ul className="mb-1 ml-[2.4375rem] mt-0.5 flex flex-col gap-0.5 border-l border-line pl-3">
                      {item.children.map((child) => (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            className={`block rounded-lg px-2.5 py-1.5 text-[0.8125rem] transition-colors ${
                              isActive(pathname, child.href)
                                ? "text-ink"
                                : "text-mute hover:text-ink"
                            }`}
                          >
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={onAsk}
                aria-haspopup="dialog"
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[0.9375rem] transition-colors ${
                  isActive(pathname, "/app/ask")
                    ? "bg-ink text-paper"
                    : "text-ink hover:bg-stone"
                }`}
              >
                <Mascot className="h-[1.125rem] w-[1.125rem]" />
                Ask
              </button>
            </li>
          </ul>
        </nav>

        <div className="shrink-0 border-t border-line p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-stone">
              <Avatar session={session} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.875rem] text-ink">
                {session.name}
              </span>
              <span className="block truncate text-[0.75rem] text-mute">
                {session.email}
              </span>
            </span>
          </div>
          <Link
            href="/app/settings"
            className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2 text-[0.875rem] text-ink transition-colors hover:bg-stone"
          >
            <SettingsIcon className="h-4 w-4 text-mute" />
            Settings
          </Link>
          <SignOutForm className="w-full rounded-xl px-3 py-2 text-left text-[0.875rem] text-ink transition-colors hover:bg-stone" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
