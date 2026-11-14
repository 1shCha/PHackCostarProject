import { SpaceRun } from "./SpaceRun";

export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { key } = await params;
  const { mode } = await searchParams;
  return <SpaceRun suiteKey={key} mode={mode === "landlord" ? "landlord" : "tenant"} />;
}
