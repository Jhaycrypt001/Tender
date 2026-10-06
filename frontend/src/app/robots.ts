import type { MetadataRoute } from "next";

/**
 * The dashboard and buyer checkout pages are private to whoever holds the
 * link or the session, so they stay out of search results. The landing page,
 * docs and blog are public.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/pay/"] }],
  };
}
