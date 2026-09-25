import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Developers · Tender" };

export default function DevelopersPage() {
  return (
    <Placeholder
      eyebrow="Settings · Developers"
      title="Developers"
      description="Your API keys, your webhook endpoint, and what we have sent it."
      building={[
        "Create and rotate API keys, shown once at creation",
        "Set a webhook URL and fire a test event at it",
        "Recent deliveries, with the response we got back",
      ]}
    />
  );
}
