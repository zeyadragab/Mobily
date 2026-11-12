export default function ProductsLoading() {
  return (
    <div className="space-y-5" role="status">
      <span className="sr-only">جاري تحميل المنتجات</span>
      <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
        <div className="h-44 rounded-[2rem] bg-line sm:h-58" />
        <div className="h-14 rounded-2xl bg-line" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="aspect-[4/5] rounded-3xl bg-line" />)}
        </div>
      </div>
    </div>
  );
}
