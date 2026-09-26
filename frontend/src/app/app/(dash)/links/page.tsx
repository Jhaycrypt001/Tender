import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Links · Tender" };

export default function LinksPage() {
  return (
    <Placeholder
      eyebrow="Reusable"
      title="Links"
      description="One link, shared once, that many buyers can pay."
      building={[
        "Create a link with a fixed amount, or let the buyer choose",
        "See how many times each link has been paid",
        "Deactivate a link without touching the payments it made",
      ]}
    />
  );
}
