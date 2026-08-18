import { Activity, Radar, TrendingUp, Zap } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";

function ProximityBar({ score, triggered }: { score: number; triggered: boolean }) {
  const pct = Math.min(score * 100, 100);
  const color = triggered
    ? "bg-[#00ff88]"
    : score >= 0.75
    ? "bg-amber-400"
    : score >= 0.5
    ? "bg-yellow-500"
    : "bg-white/20";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[.08]">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`w-12 text-right text-xs tabular-nums ${
          triggered ? "text-[#00ff88]" : score >= 0.75 ? "text-amber-400" : "text-muted-foreground"
        }`}
      >
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function VolumeBadge({ vol }: { vol: number }) {
  if (vol >= 1_000_000_000) return <span>{(vol / 1_000_000_000).toFixed(1)}B</span>;
  if (vol >= 1_000_000) return <span>{(vol / 1_000_000).toFixed(1)}M</span>;
  if (vol >= 1_000) return <span>{(vol / 1_000).toFixed(1)}K</span>;
  return <span>{vol.toFixed(0)}</span>;
}

export default function ScannerPage() {
  const { data, isLoading, dataUpdatedAt } = trpc.scanner.candidates.useQuery(undefined, {
    refetchInterval: 5_000,
    retry: 1,
  });

  const candidates = data?.candidates ?? [];
  const triggered = candidates.filter(c => c.proximity_score >= 1.0);
  const near = candidates.filter(c => c.proximity_score >= 0.5 && c.proximity_score < 1.0);
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return (
    <div className="page-enter">
      <PageHeader
        title="Radar de Sinais"
        description="Moedas mais próximas dos critérios de entrada, ordenadas por proximidade ao gatilho."
        action={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00ff88] animate-pulse" />
            Atualiza a cada 5s
            {lastUpdate && (
              <span className="ml-1 opacity-60">{lastUpdate.toLocaleTimeString("pt-BR")}</span>
            )}
          </div>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Moedas monitoradas"
          value={candidates.length}
          detail="com momentum positivo"
          icon={Radar}
          tone="slate"
        />
        <MetricCard
          label="Gatilho atingido"
          value={triggered.length}
          detail="sinais ativos esta janela"
          icon={Zap}
          tone={triggered.length > 0 ? "green" : "slate"}
        />
        <MetricCard
          label="Próximas (≥50%)"
          value={near.length}
          detail="acima de 50% do limiar"
          icon={TrendingUp}
          tone={near.length > 0 ? "amber" : "slate"}
        />
        <MetricCard
          label="Intervalo de análise"
          value={candidates[0] ? `${candidates[0].momentum_target_pct}%` : "—"}
          detail={`em ${candidates[0] ? "janela ativa" : "aguardando dados"}`}
          icon={Activity}
          tone="slate"
        />
      </section>

      <section className="cyber-surface mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Top 30 candidatos</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ordenados por proximidade ao gatilho. Verde = sinal detectado.
            </p>
          </div>
          {isLoading && (
            <span className="text-xs text-muted-foreground animate-pulse">Carregando…</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Par</th>
                <th>Preço</th>
                <th>Momentum</th>
                <th>Surge vol.</th>
                <th>Vol. 24h</th>
                <th>Spread</th>
                <th>Ticks</th>
                <th>Proximidade</th>
                <th>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {!isLoading && candidates.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-sm text-muted-foreground">
                    <Radar className="mx-auto mb-3 h-8 w-8 opacity-20" />
                    Aguardando dados do scanner. O bot precisa estar conectado e recebendo ticks.
                  </td>
                </tr>
              )}
              {candidates.map((c, i) => {
                const triggered = c.proximity_score >= 1.0;
                return (
                  <tr
                    key={c.symbol}
                    className={triggered ? "bg-[#00ff88]/[.04]" : undefined}
                  >
                    <td className="text-muted-foreground text-xs">{i + 1}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        {triggered && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[#00ff88] animate-pulse shrink-0" />
                        )}
                        <span className={`font-semibold ${triggered ? "text-[#00ff88]" : "text-foreground"}`}>
                          {c.symbol.replace("USDT", "")}
                          <span className="text-muted-foreground font-normal">/USDT</span>
                        </span>
                      </div>
                    </td>
                    <td className="tabular-nums">{formatMoney(c.price, c.price < 1 ? 6 : 4)}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span className={`tabular-nums text-sm font-medium ${triggered ? "text-[#00ff88]" : c.momentum_pct >= c.momentum_target_pct * 0.75 ? "text-amber-400" : "text-foreground"}`}>
                          +{c.momentum_pct.toFixed(2)}%
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          / {c.momentum_target_pct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span className={`tabular-nums text-sm ${c.volume_surge >= c.volume_surge_target ? "text-[#00ff88]" : "text-foreground"}`}>
                          {c.volume_surge.toFixed(1)}x
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          / {c.volume_surge_target.toFixed(1)}x
                        </span>
                      </div>
                    </td>
                    <td className="text-muted-foreground text-sm tabular-nums">
                      <VolumeBadge vol={c.volume_24h} />
                    </td>
                    <td className={`tabular-nums text-sm ${c.spread_pct > 0.5 ? "text-rose-400" : "text-muted-foreground"}`}>
                      {c.spread_pct.toFixed(3)}%
                    </td>
                    <td className="text-muted-foreground text-xs">{c.tick_count}</td>
                    <td>
                      <ProximityBar score={c.proximity_score} triggered={triggered} />
                    </td>
                    <td className="text-muted-foreground text-xs">
                      {formatDateTime(c.updated_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="cyber-surface p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Legenda</p>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#00ff88]" /> Sinal disparado (≥100%)</div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400" /> Muito próximo (≥75%)</div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-yellow-500" /> Próximo (≥50%)</div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-white/20" /> Distante (&lt;50%)</div>
          </div>
        </div>
        <div className="cyber-surface p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Proximidade</p>
          <p className="text-xs text-muted-foreground leading-5">
            Média entre o ratio de momentum e o ratio de volume surge em relação aos gatilhos configurados.
            100% = todos os critérios atingidos = sinal emitido.
          </p>
        </div>
        <div className="cyber-surface p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Atualização</p>
          <p className="text-xs text-muted-foreground leading-5">
            O scanner atualiza os candidatos a cada 3 segundos internamente.
            O dashboard puxa a lista a cada 5 segundos.
          </p>
        </div>
      </section>
    </div>
  );
}
