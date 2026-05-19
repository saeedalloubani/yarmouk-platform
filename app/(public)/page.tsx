export default function LandingPlaceholder() {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="text-[14px] font-bold text-ink tracking-tight">Yarmouk Study</div>
          <a href="/admin/login" className="btn-ghost text-[12px]">
            Researcher login →
          </a>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 pt-16 pb-24">
        <div className="eyebrow mb-4">Foundation · Session 1</div>
        <h1 className="text-[34px] font-bold leading-[1.15] text-ink tracking-tight mb-3">
          Evaluating the 1987 Yarmouk Agreement
        </h1>
        <p className="text-[17px] text-muted-strong leading-relaxed mb-10">
          Production scaffold is in place. The real landing page lands in Session 2.
        </p>

        <div className="card p-6 mb-8">
          <div className="label mb-2">Design tokens check</div>
          <div className="flex flex-wrap gap-2">
            <span className="chip-solid bg-brand-50 text-brand-700 mono">brand-50 / 700</span>
            <span className="chip-solid bg-accent-100 text-accent-800 mono">accent-100 / 800</span>
            <span className="chip-solid bg-warnLight text-warn mono">warn</span>
            <span className="chip-solid bg-dangerLight text-danger mono">danger</span>
          </div>
        </div>

        <button className="btn-primary">Primary action</button>
        <button className="btn-secondary ms-3">Secondary</button>
      </div>
    </main>
  );
}
