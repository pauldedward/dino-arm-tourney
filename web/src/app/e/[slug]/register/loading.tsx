import Spinner from "@/components/Spinner";

export default function Loading() {
  return (
    <div className="min-h-screen bg-bone">
      <Spinner variant="screen" label="Loading registration" className="min-h-screen" />
    </div>
  );
}
