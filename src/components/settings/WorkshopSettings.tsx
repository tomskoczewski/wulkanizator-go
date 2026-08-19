import { useState } from "react";
import { WorkshopDetailsForm } from "@/components/settings/WorkshopDetailsForm";
import { ServiceDurations } from "@/components/settings/ServiceDurations";
import { Bays } from "@/components/settings/Bays";
import { WorkingHours } from "@/components/settings/WorkingHours";
import type { WorkshopConfiguration } from "@/types";

interface Props {
  config: WorkshopConfiguration;
}

export default function WorkshopSettings({ config }: Props) {
  const [workshop, setWorkshop] = useState(config.workshop);

  return (
    <div className="space-y-4">
      <WorkshopDetailsForm workshop={workshop} onSaved={setWorkshop} />
      <div>
        <h2 className="text-xl font-black text-slate-900">Usługi, czasy i stanowiska</h2>
        <p className="text-xs font-medium text-slate-500">
          Warsztat ustawia, ile trwa usługa i ile stanowisk może działać równolegle.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <ServiceDurations initialServices={config.services} />
        <div className="space-y-4">
          <Bays initialBays={config.bays} />
          <WorkingHours initialHours={config.workingHours} />
        </div>
      </div>
    </div>
  );
}
