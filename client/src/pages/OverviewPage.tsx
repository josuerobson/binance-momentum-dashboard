import { Activity, CircleAlert, CircleCheck, Gauge, Landmark, TrendingUp, Wallet } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { useLiveSnapshot } from "@/hooks/useLiveSnapshot";
import { formatMoney, formatPercent } from "@/lib/format";
import { trpc } from "@/lib/trpc";

export default function OverviewPage() {
  const { data: snapshot, history, isLoading, error } = useLiveSnapshot();
  const healthQuery = trpc.telemetry.health.useQuery(undefined, { refetchInterval: 3_000, retry: 1 });
  const { data: signals } = trpc.telemetry.signals.useQuery(undefined, { refetchInterval: 5_000, retry: 1 });
  const pnl = snapshot?.positions.reduce((sum, position) => sum + (position.pnl_usdt ?? 0), 0) ?? 0;
  const rate = snapshot ? (snapshot.request_weight.used_weight / Math.max(snapshot.request_weight.limit, 1)) * 100 : 0;
  const health = healthQuery.data ?? snapshot?.health;
  const isHealthy = health?.status === "ok" && !health.reconciliation_required;
  return (
    <div className="page-enter">
      <PageHeader title="Centro de comando" description="Acompanhe saldo, exposição, risco e sinais recebidos. Dados atualizados em ciclos de até 3 segundos." action={<div className={`status-chip ${isHealthy ? "status-healthy" : "status-warning"}`}>{isHealthy ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}{isHealthy ? "BOT OPERACIONAL" : "VERIFICAR BOT"}</div>} />
      {error && <div className="mb-6 rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error.message}</div>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Saldo disponível" value={`${formatMoney(snapshot?.balance.usdt_free)} USDT`} detail="saldo livre em carteira" icon={Wallet} />
        <MetricCard label="Posições abertas" value={snapshot?.positions.length ?? "—"} detail={`${snapshot?.symbols.pending.length ?? 0} símbolo(s) em análise`} icon={Landmark} tone="slate" />
        <MetricCard label="P&L em aberto" value={`${pnl >= 0 ? "+" : ""}${formatMoney(pnl)} USDT`} detail={formatPercent(snapshot?.positions.reduce((sum, position) => sum + (position.pnl_pct ?? 0), 0) ?? 0)} icon={TrendingUp} tone={pnl >= 0 ? "green" : "red"} change={pnl} />
        <MetricCard label="Peso de requisições" value={`${formatMoney(rate, 0)}%`} detail={`${snapshot?.request_weight.used_weight ?? 0}/${snapshot?.request_weight.limit ?? 0} por minuto`} icon={Gauge} tone={rate >= 80 ? "amber" : "green"} />
        <MetricCard label="Sinais capturados" value={signals?.count ?? "—"} detail={`cache: ${snapshot?.symbols.cached_count ?? 0} pares`} icon={Activity} tone="amber" />
      </section>
      <section className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <article className="cyber-surface min-h-[320px] p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-foreground">Evolução do P&L aberto</p><p className="mt-1 text-xs text-muted-foreground">Amostras desta sessão, geradas pelo polling do snapshot.</p></div><span className="text-xs text-muted-foreground">{isLoading ? "Sincronizando…" : "Ao vivo"}</span></div>
          <div className="h-[235px]">{history.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={history} margin={{ left: -16, right: 4, top: 12, bottom: 0 }}><defs><linearGradient id="pnl-area" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00ff88" stopOpacity={0.28} /><stop offset="95%" stopColor="#00ff88" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="time" tick={{ fill: "#7d8aa6", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={30} /><YAxis tick={{ fill: "#7d8aa6", fontSize: 11 }} tickLine={false} axisLine={false} width={55} /><Tooltip contentStyle={{ background: "#101727", border: "1px solid rgba(0,255,136,.22)", borderRadius: 10 }} labelStyle={{ color: "#9da9c1" }} itemStyle={{ color: "#00ff88" }} /><Area dataKey="pnl" name="P&L (USDT)" type="monotone" stroke="#00ff88" strokeWidth={2} fill="url(#pnl-area)" /></AreaChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-muted-foreground">Aguardando a primeira amostra de telemetria.</div>}</div>
        </article>
        <article className="cyber-surface p-5 sm:p-6"><p className="text-sm font-semibold text-foreground">Saúde e proteção</p><p className="mt-1 text-xs text-muted-foreground">Indicadores que bloqueiam ou condicionam entradas.</p><dl className="mt-5 divide-y divide-white/[0.07]">{[["Estado", health?.status ?? "—"], ["Reconciliação", health?.reconciliation_required ? "em andamento" : "normal"], ["Símbolos bloqueados", health?.blocked_symbols ?? "—"], ["Modo", snapshot?.mode.use_testnet ? "testnet" : "produção"], ["DRY_RUN", snapshot?.mode.dry_run ? "ativado" : "desativado"]].map(([label, value]) => <div className="flex items-center justify-between py-3 text-sm" key={label as string}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium text-foreground">{value}</dd></div>)}</dl></article>
      </section>
      <section className="cyber-surface mt-5 overflow-hidden"><div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4"><div><p className="text-sm font-semibold text-foreground">Sinais recentes</p><p className="mt-1 text-xs text-muted-foreground">Últimos critérios de momentum registrados pelo scanner.</p></div><span className="text-xs text-[#00ff88]">{signals?.count ?? 0} registros</span></div><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Par</th><th>Preço</th><th>Variação</th><th>Volume</th><th>Spread</th></tr></thead><tbody>{signals?.signals.slice(0, 5).map(signal => <tr key={`${signal.symbol}-${signal.detected_at}`}><td className="font-medium text-foreground">{signal.symbol}</td><td>{formatMoney(signal.current_price, 6)}</td><td className={signal.pct_change >= 0 ? "text-[#00ff88]" : "text-rose-300"}>{formatPercent(signal.pct_change)}</td><td>{formatMoney(signal.volume_surge)}x</td><td>{formatMoney(((signal.ask - signal.bid) / signal.bid) * 100, 3)}%</td></tr>) ?? <tr><td className="py-8 text-center text-muted-foreground" colSpan={5}>Nenhum sinal recente registrado.</td></tr>}</tbody></table></div></section>
    </div>
  );
}
