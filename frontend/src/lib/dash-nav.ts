import {
  ActivityIcon,
  AskIcon,
  CheckoutIcon,
  EarnIcon,
  HomeIcon,
  LinkIcon,
  PayIcon,
  RampsIcon,
} from "@/components/dash/icons";

/**
 * The dashboard navigation, declared once.
 *
 * Desktop nav, mobile sheet and the active-state logic all read from here, so
 * a tab cannot appear in one and be missing from another.
 *
 * Every label names the merchant's side of the transaction, in the plainest
 * word available. "Treasury" is settled revenue put to work, not a savings
 * account. "Pay" is money going back out as refunds and payouts, not sending
 * someone a tenner. "Cash out" says what it does, where a word like "ramps"
 * would assume the merchant already speaks crypto.
 */

export type NavChild = {
  label: string;
  href: string;
  desc: string;
};

export type NavItem = {
  label: string;
  href: string;
  icon: (props: { className?: string }) => React.ReactElement;
  /**
   * Shorter wording for the tab rail between md and xl, where seven tabs are
   * sharing the header with the account controls. Only set it where the short
   * form still names the same thing; `label` is what everything else reads.
   */
  short?: string;
  /** Renders as a dropdown on desktop and a nested group on mobile. */
  children?: NavChild[];
};

export const NAV: NavItem[] = [
  {
    label: "Home",
    href: "/app/home",
    icon: HomeIcon,
  },
  {
    label: "Pay",
    href: "/app/pay",
    icon: PayIcon,
    children: [
      {
        label: "Refund",
        href: "/app/pay/refund",
        desc: "Return a payment to the buyer who made it",
      },
      {
        label: "Payout",
        href: "/app/pay/payout",
        desc: "Send settled revenue to a supplier or contractor",
      },
      {
        label: "Split",
        href: "/app/pay/split",
        desc: "Divide one payment across several addresses",
      },
    ],
  },
  {
    label: "Treasury",
    href: "/app/earn",
    icon: EarnIcon,
  },
  {
    label: "Checkout",
    href: "/app/checkout",
    icon: CheckoutIcon,
  },
  {
    label: "Activity",
    href: "/app/activity",
    icon: ActivityIcon,
  },
  {
    label: "Payment links",
    short: "Links",
    href: "/app/links",
    icon: LinkIcon,
  },
  {
    label: "Cash out",
    href: "/app/ramps",
    icon: RampsIcon,
  },
];

/** Reachable from the avatar menu rather than the tab rail. */
export const ASK_ITEM: NavItem = {
  label: "Ask",
  href: "/app/ask",
  icon: AskIcon,
};

/**
 * Whether a nav item owns the current path.
 *
 * Prefix matching, so `/app/checkout/new` keeps Checkout lit — but guarded on
 * a `/` boundary, otherwise `/app/payments` would also light up `/app/pay`.
 */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Display currencies for the header selector.
 *
 * ⚠️ This changes presentation only. It is NOT the settlement asset — that is
 * what payments actually convert into before they land, it lives in Settings,
 * and confusing the two would let a merchant believe they had changed where
 * their money goes by picking a flag in the header.
 */
export const DISPLAY_CURRENCIES = [
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "British Pound" },
  { code: "NGN", symbol: "₦", label: "Nigerian Naira" },
  { code: "JPY", symbol: "¥", label: "Japanese Yen" },
  { code: "CAD", symbol: "$", label: "Canadian Dollar" },
  { code: "AUD", symbol: "$", label: "Australian Dollar" },
  { code: "CHF", symbol: "Fr", label: "Swiss Franc" },
  { code: "INR", symbol: "₹", label: "Indian Rupee" },
  { code: "BRL", symbol: "R$", label: "Brazilian Real" },
  { code: "ZAR", symbol: "R", label: "South African Rand" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham" },
  { code: "SGD", symbol: "$", label: "Singapore Dollar" },
] as const;

/**
 * One entry from `DISPLAY_CURRENCIES`.
 *
 * Needed because `as const` narrows each element to its own literal type, so
 * a `useState` initialised from the first entry would only ever accept USD.
 */
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
