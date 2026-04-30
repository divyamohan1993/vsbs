import { AutonomyDashboard } from "./AutonomyDashboard";

export default async function AutonomyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-10 md:px-6 md:py-14 lg:px-8">
      <AutonomyDashboard bookingId={id} />
    </div>
  );
}
