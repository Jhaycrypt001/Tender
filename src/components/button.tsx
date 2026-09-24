import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "ghost" | "inverse";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2.5 rounded-full font-medium whitespace-nowrap transition-colors duration-300";

const sizes: Record<Size, string> = {
  md: "px-5 py-2.5 text-[0.875rem]",
  // The hero pair on goldsand.fi sits noticeably taller than the nav pills.
  lg: "px-6 py-3 text-[0.9375rem]",
};

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/85",
  ghost: "border border-line text-ink hover:border-ink/40 hover:bg-stone",
  inverse: "bg-paper text-ink hover:bg-stone",
};

export default function Button({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  ...props
}: {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
} & ComponentProps<typeof Link>) {
  return (
    <Link
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </Link>
  );
}
