import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Home · Tender" };

export default function HomePage() {
  return (
    <Placeholder
      eyebrow="Overview"
      title="Home"
      description="What your customers have paid you, and what has settled on Monad."
      building={[
        "Settled balance, with the unsettled total beside it",
        "Your settlement address, ready to copy",
        "Create an invoice or a pay link in one click",
        "The most recent payments, newest first",
      ]}
    />
  );
}
