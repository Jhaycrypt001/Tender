import { encodeQR, qrPath } from "@/lib/qr";

/**
 * The payment QR.
 *
 * Rendered on the server: the grid is deterministic, so it ships as markup and
 * the buyer's phone does no work to draw it. That matters because this is the
 * one element on the page a buyer physically waits for.
 *
 * The white quiet zone is not optional. Scanners need four modules of margin to
 * find the code, and a QR flush against a dark panel frequently will not scan —
 * which on this page reads to the buyer as "this payment is broken".
 */
export function QRCode({
  value,
  size = 200,
  className = "",
}: {
  value: string;
  /** Rendered pixel size. The SVG scales, so this is a layout hint only. */
  size?: number;
  className?: string;
}) {
  let rows: boolean[][];
  try {
    rows = encodeQR(value);
  } catch {
    // Too long to encode. Never render a broken code — the address text below
    // it on the page is the fallback, and it is always present.
    return null;
  }

  const modules = rows.length;
  const QUIET = 4;
  const extent = modules + QUIET * 2;

  return (
    <svg
      viewBox={`0 0 ${extent} ${extent}`}
      width={size}
      height={size}
      className={`block ${className}`}
      role="img"
      aria-label="Payment address as a QR code"
      shapeRendering="crispEdges"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <g transform={`translate(${QUIET} ${QUIET})`}>
        {/* One path for the whole code rather than a rect per module. */}
        <path d={qrPath(rows)} fill="#121111" />
      </g>
    </svg>
  );
}
