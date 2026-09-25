import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Settings · Tender" };

export default function SettingsPage() {
  return (
    <Placeholder
      eyebrow="Account"
      title="Settings"
      description="Your profile, where money settles, and your API keys."
      building={[
        "Settlement address and asset, with proof of control before it goes live",
        "API keys, webhook endpoint and recent deliveries",
        "Profile and display preferences",
      ]}
    />
  );
}
