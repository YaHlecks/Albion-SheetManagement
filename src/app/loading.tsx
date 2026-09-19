export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading">
      <div className="w-full max-w-6xl space-y-4 px-4">
        <div className="skeleton h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="skeleton h-24" />
          <div className="skeleton h-24" />
          <div className="skeleton h-24" />
          <div className="skeleton h-24" />
        </div>
        <div className="skeleton h-64" />
      </div>
    </div>
  );
}
