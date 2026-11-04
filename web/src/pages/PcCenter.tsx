import { DevicesSection } from "../components/DevicesSection";
import { PcSection } from "../components/PcSection";

/** PC Control Center: what agents may do on this computer, and which phones may reach it. */
export function PcCenter() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">PC Control Center</h1>
      <PcSection />
      <DevicesSection />
    </div>
  );
}
