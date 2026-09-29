"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TenderMark } from "@/components/logo";
import {
  AskIcon,
  ChevronDownIcon,
  CloseIcon,
  MenuIcon,
  SettingsIcon,
} from "@/components/dash/icons";
import {
  DISPLAY_CURRENCIES,
  NAV,
  isActive,
  type DisplayCurrency,
  type NavItem,
} from "@/lib/dash-nav";

/**
 * The dashboard header.
 *
 * Three popovers live here — the Pay dropdown, the currency picker and the
 * avatar menu — and they share one piece of machinery (`useDismiss`) rather
 * than each growing their own listeners. All three close on Escape, on an
 * outside click, and on navigation.
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
  const [open, setOpen] = useState<Open>(null);
  const [mobile, setMobile] = useState(false);
  // ⚠️ Fixed, not state. Picking another currency would relabel the header
  // while every amount on screen stayed in its settlement asset — a number the
  // merchant did not ask for, dressed as one they did. The other codes stay
  // listed as Soon until an FX feed exists to convert with.
  const currency: DisplayCurrency = DISPLAY_CURRENCIES[0];
  const headerRef = useRef<HTMLElement>(null);

  // Any navigation dismisses everything. Without this a dropdown stays open
  // over the new page, because the click that navigated never left the header.
  useEffect(() => {
    setOpen(null);
    setMobile(false);
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
          <span className="hidden font-display text-[1.25rem] leading-none sm:block">
            tender
          </span>
          <span className="ml-0.5 rounded-full border border-line px-1.5 py-[0.1875rem] font-mono text-[0.5625rem] uppercase leading-none tracking-[0.12em] text-mute">
            Beta
          </span>
        </Link>

        {/* Tab rail. Hidden below xl: seven tabs plus the right-hand controls
            need real width, and collapsing earlier avoids a cramped middle
            state where labels truncate. */}
        <nav aria-label="Dashboard" className="mx-auto hidden xl:block">
          <ul className="flex items-center gap-0.5">
            {NAV.map((item) =>
              item.children ? (
                <li key={item.href} className="relative">
                  <DropdownTrigger
                    item={item}
                    active={isActive(pathname, item.href)}
                    open={open === "pay"}
                    onClick={() => toggle("pay")}
                  />
                  {open === "pay" && <PayMenu item={item} pathname={pathname} />}
                </li>
              ) : (
                <li key={item.href}>
                  <TabLink item={item} active={isActive(pathname, item.href)} />
                </li>
              ),
            )}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1.5 xl:ml-0">
          {/* Ask — the natural-language query box, reachable everywhere. */}
          <Link
            href="/app/ask"
            aria-label="Ask about your payments"
            className={`hidden h-9 w-9 items-center justify-center rounded-full border transition-colors sm:flex ${
              isActive(pathname, "/app/ask")
                ? "border-ink bg-ink text-paper"
                : "border-line text-ink hover:bg-stone"
            }`}
          >
            <AskIcon className="h-[1.125rem] w-[1.125rem]" />
          </Link>

          {/* Display currency */}
          <div className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => toggle("currency")}
              aria-expanded={open === "currency"}
              aria-haspopup="listbox"
              className="flex h-9 items-center gap-1.5 rounded-full border border-line px-3 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink transition-colors hover:bg-stone"
            >
              {currency.code} · {currency.symbol}
              <ChevronDownIcon
                className={`h-3.5 w-3.5 text-mute transition-transform ${
                  open === "currency" ? "rotate-180" : ""
                }`}
              />
            </button>
            {open === "currency" && (
              <div
                role="listbox"
                aria-label="Display currency"
                className="absolute right-0 top-[calc(100%+0.5rem)] max-h-[19rem] w-[14rem] overflow-y-auto rounded-2xl border border-line bg-paper p-1.5 shadow-[0_18px_40px_-12px_rgba(18,17,17,0.22)]"
              >
                <p className="px-2.5 pb-1 pt-2 font-mono text-[0.5625rem] uppercase tracking-[0.16em] text-mute">
                  Display currency
                </p>
                <p className="px-2.5 pb-2 text-[0.6875rem] leading-snug text-mute">
                  Amounts show in the asset they settle in. Other currencies
                  need a live FX rate, which is not connected yet.
                </p>
                {DISPLAY_CURRENCIES.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    role="option"
                    aria-selected={item.code === currency.code}
                    aria-disabled={item.code !== currency.code}
                    disabled={item.code !== currency.code}
                    onClick={() => setOpen(null)}
                    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[0.8125rem] transition-colors disabled:cursor-not-allowed ${
                      item.code === currency.code
                        ? "bg-stone text-ink"
                        : "text-mute"
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="font-mono text-[0.6875rem] text-mute">
                      {item.code === currency.code ? item.code : "Soon"}
                    </span>
                  </button>
                ))}
              </div>
            )}
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
            {open === "avatar" && <AvatarMenu session={session} />}
          </div>

          {/* Mobile trigger */}
          <button
            type="button"
            onClick={() => setMobile(true)}
            aria-label="Open menu"
            aria-expanded={mobile}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-stone xl:hidden"
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
        />
      )}
    </header>
  );
}

/* -------------------------------------------------------------------------- */

/** Active tab is a filled ink pill; inactive is quiet until hovered. */
function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.8125rem] transition-colors ${
        active ? "bg-ink text-paper" : "text-mute hover:bg-stone hover:text-ink"
      }`}
    >
      <Icon className="h-[1.0625rem] w-[1.0625rem]" />
      {item.label}
    </Link>
  );
}

function DropdownTrigger({
  item,
  active,
  open,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  open: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="menu"
      className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.8125rem] transition-colors ${
        active || open
          ? "bg-ink text-paper"
          : "text-mute hover:bg-stone hover:text-ink"
      }`}
    >
      <Icon className="h-[1.0625rem] w-[1.0625rem]" />
      {item.label}
      <ChevronDownIcon
        className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

/** Each row carries a one-line description: these three verbs are close enough
 *  that a bare label leaves a merchant guessing which one they want. */
function PayMenu({ item, pathname }: { item: NavItem; pathname: string }) {
  return (
    <div
      role="menu"
      className="absolute left-1/2 top-[calc(100%+0.5rem)] w-[17.5rem] -translate-x-1/2 rounded-2xl border border-line bg-paper p-1.5 shadow-[0_18px_40px_-12px_rgba(18,17,17,0.22)]"
    >
      {item.children?.map((child) => (
        <Link
          key={child.href}
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
      ))}
    </div>
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

function AvatarMenu({ session }: { session: Session }) {
  return (
    <div
      role="menu"
      className="absolute right-0 top-[calc(100%+0.5rem)] w-[16rem] rounded-2xl border border-line bg-paper p-1.5 shadow-[0_18px_40px_-12px_rgba(18,17,17,0.22)]"
    >
      <div className="px-3 py-2.5">
        <p className="truncate text-[0.875rem] text-ink">{session.name}</p>
        <p className="truncate text-[0.75rem] text-mute">{session.email}</p>
      </div>
      <div className="my-1 h-px bg-line" />
      <Link
        href="/app/settings"
        role="menuitem"
        className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[0.8125rem] text-ink transition-colors hover:bg-stone"
      >
        <SettingsIcon className="h-4 w-4 text-mute" />
        Settings
      </Link>
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
      <div className="my-1 h-px bg-line" />
      {/* A real form POST, not a link: signing out changes state, and a GET
          that mutates is fetchable by anything that prefetches. */}
      <form action="/app/signout" method="post">
        <button
          type="submit"
          role="menuitem"
          className="w-full rounded-xl px-3 py-2 text-left text-[0.8125rem] text-ink transition-colors hover:bg-stone"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MobileSheet({
  pathname,
  session,
  onClose,
}: {
  pathname: string;
  session: Session;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 xl:hidden">
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
              <Link
                href="/app/ask"
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] transition-colors ${
                  isActive(pathname, "/app/ask")
                    ? "bg-ink text-paper"
                    : "text-ink hover:bg-stone"
                }`}
              >
                <AskIcon className="h-[1.125rem] w-[1.125rem]" />
                Ask
              </Link>
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
          <form action="/app/signout" method="post">
            <button
              type="submit"
              className="w-full rounded-xl px-3 py-2 text-left text-[0.875rem] text-ink transition-colors hover:bg-stone"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
