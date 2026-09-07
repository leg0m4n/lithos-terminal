import { CompsMode } from "@/components/comps/comps-mode";
import { getStoneTypeOptions } from "@/lib/market-data";

export const dynamic = "force-dynamic";

export default async function CompsPage() {
  const stoneTypeOptions = await getStoneTypeOptions();
  return <CompsMode stoneTypeOptions={stoneTypeOptions} />;
}
