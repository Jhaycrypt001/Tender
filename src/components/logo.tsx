/**
 * The Tender mark: four bars angled in from the corners, stopping short of the
 * centre so a small square of negative space is left open — many chains
 * arriving, one destination.
 *
 * Redrawn from tender.png as geometry rather than shipping the raster. The PNG
 * is white-on-black with a wide margin, so it could only ever sit on a dark
 * panel; as paths it inherits `currentColor`, which is what lets the same mark
 * be ink on the white login card and white in the dark footer.
 */
export function TenderMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="Tender"
      className={className}
      fill="currentColor"
    >
      <polygon points="8,7 15.2,7 24.6,20.4 20.4,22.6" />
      <polygon points="32.8,7 40,7 27.6,22.6 23.4,20.4" />
      <polygon points="20.4,25.4 24.6,27.6 15.2,41 8,41" />
      <polygon points="23.4,27.6 27.6,25.4 40,41 32.8,41" />
    </svg>
  );
}
