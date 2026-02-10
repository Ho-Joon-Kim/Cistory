export function MapSkeleton() {
  return (
    <div className="h-full w-full ds-skeleton flex items-center justify-center rounded-sm">
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 rounded-full ds-skeleton" />
        <div className="h-2 w-20 ds-skeleton" />
      </div>
    </div>
  );
}
