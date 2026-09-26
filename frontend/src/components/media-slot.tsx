import fs from "node:fs";
import path from "node:path";
import Image from "next/image";

/**
 * Renders a generated image if it exists on disk, and a labelled placeholder
 * of the same aspect ratio if it does not.
 *
 * The three dark sections are built ahead of their renders. Pointing
 * next/image at a missing file throws at request time and takes the whole
 * page down, so existence is checked at render (server component, so this is
 * build/request-time Node, never shipped to the browser). Drop the PNG into
 * public/img and the placeholder is replaced with no code change.
 */
export default function MediaSlot({
  src,
  alt,
  width,
  height,
  sizes,
  className = "",
  tone = "dark",
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  className?: string;
  tone?: "dark" | "light";
}) {
  const exists = fs.existsSync(
    path.join(process.cwd(), "public", src.replace(/^\//, "")),
  );

  if (exists) {
    return (
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        className={className}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={alt}
      style={{ aspectRatio: `${width} / ${height}` }}
      className={`flex items-center justify-center rounded-[20px] border border-dashed ${
        tone === "dark"
          ? "border-paper/20 bg-paper/[0.04] text-paper/40"
          : "border-line bg-stone text-mute"
      } ${className}`}
    >
      <span className="px-6 text-center font-mono text-[0.6875rem] uppercase leading-relaxed tracking-[0.14em]">
        {src}
      </span>
    </div>
  );
}
