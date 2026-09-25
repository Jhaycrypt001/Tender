import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Ramps · Tender" };

export default function RampsPage() {
  return (
    <Placeholder
      eyebrow="Cash out"
      title="Ramps"
      description="Settled revenue out to a bank account."
      building={[
        "Off-ramp corridors, with the live ones marked plainly",
        "Daily limits shown before you start, not after",
      ]}
    />
  );
}
