import Hero from "@/components/sections/hero";
import Testimonials from "@/components/sections/testimonials";
import Stats from "@/components/sections/stats";
import FeeScroll from "@/components/sections/fee-scroll";
import Comparison from "@/components/sections/comparison";
import Showcase from "@/components/sections/showcase";
import Capabilities from "@/components/sections/capabilities";
import HowItWorks from "@/components/sections/how-it-works";
import Anywhere from "@/components/sections/anywhere";
import Card from "@/components/sections/card";
import SettleLive from "@/components/sections/settle-live";
import Abandonment from "@/components/sections/abandonment";
import Chains from "@/components/sections/chains";
import Insights from "@/components/sections/insights";
import Faq from "@/components/sections/faq";
import Cta from "@/components/sections/cta";

/**
 * Section order. Anywhere → Card → SettleLive are deliberately adjacent so the
 * ink ground reads as one continuous dark run rather than three stripes; each
 * of the latter two drops its own top padding to keep that seam invisible.
 */
export default function Home() {
  return (
    <>
      <Hero />
      <Testimonials />
      <Stats />
      <FeeScroll />
      <Comparison />
      <Showcase />
      <Capabilities />
      <HowItWorks />
      <Anywhere />
      <Card />
      <SettleLive />
      <Abandonment />
      <Chains />
      <Insights />
      <Faq />
      <Cta />
    </>
  );
}
