import { FlaskConical, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatMoney, formatPercent } from "@/lib/format";
import { trpc } from "@/lib/trpc";

function ExitBadge({ reason }: { reason: string }) {
  const map: Record<string, string> = { TP: "text-[#00ff88] bg-[#00ff88]/10 border-[#00ff88]/20", SL: "text-rose-400 bg-rose-400/10 border-rose-400/20" };
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${map[reason] ?? "text-slate-300 bg-white/5 border-white/10"}`}>{reason}</span>;
}

export default function PaperTradingPage() {
  const { data: pos, isLoading: posLoading } = trpc.paper.positions.useQuery(undefined, { refetchInterval: 5_000, retry: 1 });
  const { data: hist, isLoading: histLoading } = trpc.paper.history.useQuery(undefined, { refetchInterval: 10_000, retry: 1 });

  const equityCurve = (() => {
    if (!hist?.history.length) return [];
    let cumPnl = 0;
    return [...hist.history]
      .sort((a, b) => a.closed_at - b.closed_at)
      .map(t => {
        cumPnl += t.pnl_usdt;
        return { time: new Date(t.closed_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), pnl: parseFloat(cumPnl.toFixed(2)) };
      });
  })();

  const totalPnl = hist?.total_pnl_usdt ?? 0;
  const winRate = hist?.win_rate_pct ?? 0;
  const paperBalance = pos?.paper_balance ?? hist?.paper_balance ?? 0;

  return (
    <div className="page-enter">
      <PageHeader
        title="Paper Trading"
        description="Simulação com dados reais da Binance. Nenhum capital real é utilizado."
        action={<div className="status-chip status-neutral"><FlaskConical className="h-3.5 w-3.5" />SIMULAÇÃO</div>}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Saldo virtual" value={`${formatMoney(paperBalance)} USDT`} detail="capital simulado disponível" icon={Wallet} tone="slate" />
        <MetricCard label="Posições abertas" value={pos?.count ?? "—"} detail="monitoradas em tempo real" icon={FlaskConical} tone="amber" />
        <MetricCard label="P&L acumulado" value={`${totalPnl >= 0 ? "+" : ""}${formatMoney(totalPnl)} USDT`} detail={`${hist?.count ?? 0} operações fechadas`} icon={totalPnl >= 0 ? TrendingUp : TrendingDown} tone={totalPnl >= 0 ? "green" : "red"} change={totalPnl} />
        <MetricCard label="Taxa de acerto" value={`${formatMoney(winRate, 1)}%`} detail={`${hist?.wins ?? 0} ganhos / ${hist?.losses ?? 0} perdas`} icon={TrendingUp} tone={winRate >= 50 ? "green" : "amber"} />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <article className="cyber-surface min-h-[280px] p-5 sm:p-6">
          <p className="text-sm font-semibold text-foreground">Curva de equidade (paper)</p>
          <p className="mt-1 text-xs text-muted-foreground">P&L acumulado das operações simuladas fechadas.</p>
          <div className="mt-5 h-[200px]">
            {equityCurve.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityCurve} margin={{ left: -16, right: 4, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="equity-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00ff88" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: "#7d8aa6", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis tick={{ fill: "#7d8aa6", fontSize: 11 }} tickLine={false} axisLine={false} width={55} />
                  <Tooltip contentStyle={{ background: "#101727", border: "1px solid rgba(0,255,136,.22)", borderRadius: 10 }} labelStyle={{ color: "#9da9c1" }} itemStyle={{ color: "#00ff88" }} />
                  <Area dataKey="pnl" name="P&L (USDT)" type="monotone" stroke="#00ff88" strokeWidth={2} fill="url(#equity-area)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                Aguardando operações para traçar a curva.
              </div>
            )}
          </div>
        </article>

        <article className="cyber-surface p-5 sm:p-6">
          <p className="text-sm font-semibold text-foreground">Posições abertas</p>
          <p className="mt-1 text-xs text-muted-foreground">Sendo monitoradas contra SL/TP em tempo real.</p>
          {posLoading && <p className="mt-6 text-sm text-muted-foreground">Carregando…</p>}
          {!posLoading && !pos?.positions.length && (
            <p className="mt-6 text-sm text-muted-foreground">Nenhuma posição paper aberta.</p>
          )}
          <div className="mt-4 space-y-3">
            {pos?.positions.map(p => (
              <div key={`${p.symbol}-${p.opened_at}`} className="rounded-lg border border-white/[.07] bg-white/[.02] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{p.symbol}</span>
                  <span className="text-xs text-amber-400">{formatMoney(p.virtual_usdt)} USDT</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-muted-foreground">
                  <span>Entrada: <span className="text-foreground">{formatMoney(p.entry_price, 6)}</span></span>
                  <span>SL: <span className="text-rose-400">{formatMoney(p.stop_price, 6)}</span></span>
                  <span>TP: <span className="text-[#00ff88]">{formatMoney(p.take_profit_price, 6)}</span></span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(p.opened_at)}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="cyber-surface mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Histórico de operações</p>
            <p className="mt-1 text-xs text-muted-foreground">Últimas operações simuladas encerradas pelo bot.</p>
          </div>
          <span className="text-xs text-[#00ff88]">{hist?.count ?? 0} fechadas</span>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Par</th><th>Entrada</th><th>Saída</th><th>P&L %</th><th>P&L USDT</th><th>Motivo</th><th>Duração</th><th>Fechada em</th></tr>
            </thead>
            <tbody>
              {histLoading && (
                <tr><td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Carregando histórico…</td></tr>
              )}
              {!histLoading && !hist?.history.length && (
                <tr><td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Nenhuma operação fechada ainda. O bot precisa detectar sinais e acionar SL ou TP.</td></tr>
              )}
              {hist?.history.map(t => (
                <tr key={`${t.symbol}-${t.opened_at}`}>
                  <td className="font-semibold text-foreground">{t.symbol}</td>
                  <td>{formatMoney(t.entry_price, 6)}</td>
                  <td>{formatMoney(t.exit_price, 6)}</td>
                  <td className={t.pnl_pct >= 0 ? "text-[#00ff88]" : "text-rose-300"}>{formatPercent(t.pnl_pct)}</td>
                  <td className={t.pnl_usdt >= 0 ? "text-[#00ff88]" : "text-rose-300"}>{formatMoney(t.pnl_usdt)} USDT</td>
                  <td><ExitBadge reason={t.exit_reason} /></td>
                  <td>{t.duration_ms < 60_000 ? `${Math.round(t.duration_ms / 1000)}s` : `${Math.round(t.duration_ms / 60_000)}m`}</td>
                  <td>{formatDateTime(t.closed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
