import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export function MetricCard({ label, value, detail, icon: Icon, tone = "green", change }: { label: string; value: ReactNode; detail: string; icon: LucideIcon; tone?: "green" | "amber" | "red" | "slate"; change?: number }) {
  const toneClass = { green: "text-[#00ff88] border-[#00ff88]/20 bg-[#00ff88]/10", amber: "text-[#f59e0b] border-[#f59e0b]/20 bg-[#f59e0b]/10", red: "text-rose-400 border-rose-400/20 bg-rose-400/10", slate: "text-slate-300 border-white/10 bg-white/[0.04]" }[tone];
  return (
    <article className="cyber-surface group relative overflow-hidden p-5">
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-current opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-[0.08]" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            {change !== undefined && (change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5 text-[#00ff88]" /> : <ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />)}
            <span>{detail}</span>
          </div>
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-xl border ${toneClass}`}><Icon className="h-4.5 w-4.5" /></div>
      </div>
    </article>
  );
}
