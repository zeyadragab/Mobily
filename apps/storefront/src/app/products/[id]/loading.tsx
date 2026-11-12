export default function ProductLoading() {
  return (
    <div role="status">
      <span className="sr-only">جاري تحميل تفاصيل المنتج</span>
      <div aria-hidden="true" className="grid gap-6 md:grid-cols-2 md:gap-10 motion-safe:animate-pulse">
        <div className="aspect-square rounded-3xl bg-line" />
        <div className="space-y-4">
          <div className="h-10 w-3/4 rounded-xl bg-line" />
          <div className="h-52 rounded-3xl bg-line" />
        </div>
      </div>
    </div>
  );
}
