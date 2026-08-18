import { ArrowRightLeft, Info, TrendingUp, Triangle, Zap } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";

type ArbOpportunity = {
  id: number;
  direction: string;
  path: string;
  base: string;
  btc_usdt_price: number;
  alt_btc_price: number;
  alt_usdt_price: number;
  gross_pct: number;
  fees_pct: number;
  net_pct: number;
  detected_at: number;
};

function NetBadge({ pct }: { pct: number }) {
  const profitable = pct > 0;
  const near = pct > -0.15 && pct <= 0;
  const cls = profitable
    ? "text-[#00ff88] font-semibold"
    : near
    ? "text-amber-400"
    : "text-rose-400";
  return (
    <span className={`tabular-nums text-sm ${cls}`}>
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(4)}%
    </span>
  );
}

function DirectionChip({ dir }: { dir: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${dir === "forward" ? "bg-sky-400/10 text-sky-300" : "bg-violet-400/10 text-violet-300"}`}>
      {dir === "forward" ? "direto" : "reverso"}
    </span>
  );
}

export default function ArbPage() {
  const { data, isLoading, dataUpdatedAt } = trpc.arb.opportunities.useQuery(undefined, {
    refetchInterval: 5_000,
    retry: 1,
  });

  const opps: ArbOpportunity[] = data?.opportunities ?? [];
  const profitable = data?.profitable_count ?? 0;
  const triangles = data?.triangles_monitored ?? 0;
  const bestNet = data?.best_net_pct ?? null;
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  const FEE_HURDLE = 0.3003; // 3 × 0.1% taker fee

  return (
    <div className="page-enter">
      <PageHeader
        title="Arbitragem Triangular"
        description="Detecção em tempo real de divergências de preço entre pares BTC e USDT para a mesma moeda."
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
          label="Triângulos monitorados"
          value={triangles}
          detail="pares com rota ALT/BTC + ALT/USDT"
          icon={Triangle}
          tone="slate"
        />
        <MetricCard
          label="Detectadas"
          value={opps.length}
          detail={`últimas ${opps.length > 0 ? "sessão" : "—"}`}
          icon={ArrowRightLeft}
          tone={opps.length > 0 ? "green" : "slate"}
        />
        <MetricCard
          label="Lucrativas (líq. > 0%)"
          value={profitable}
          detail={`após 3 × 0,1% de taxas`}
          icon={Zap}
          tone={profitable > 0 ? "green" : "slate"}
        />
        <MetricCard
          label="Melhor retorno líquido"
          value={bestNet !== null ? `${bestNet >= 0 ? "+" : ""}${bestNet.toFixed(4)}%` : "—"}
          detail="melhor oportunidade detectada"
          icon={TrendingUp}
          tone={bestNet !== null && bestNet > 0 ? "green" : "slate"}
        />
      </section>

      {/* How it works */}
      <section className="mt-5 cyber-surface p-5">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#00ff88]" />
          <div className="space-y-2 text-xs text-muted-foreground leading-5">
            <p>
              <strong className="text-foreground">Como funciona:</strong>{" "}
              Para cada moeda ALT com par em BTC <em>e</em> em USDT, o sistema calcula dois caminhos:
            </p>
            <div className="grid gap-3 sm:grid-cols-2 mt-2">
              <div className="rounded-lg border border-sky-400/15 bg-sky-400/5 p-3">
                <p className="font-semibold text-sky-300 mb-1">Direto (forward)</p>
                <p className="font-mono text-[11px]">USDT → comprar BTC → comprar ALT com BTC → vender ALT por USDT</p>
                <p className="mt-1">Lucro bruto = bid(ALT/USDT) ÷ (ask(BTC/USDT) × ask(ALT/BTC))</p>
              </div>
              <div className="rounded-lg border border-violet-400/15 bg-violet-400/5 p-3">
                <p className="font-semibold text-violet-300 mb-1">Reverso (reverse)</p>
                <p className="font-mono text-[11px]">USDT → comprar ALT → vender ALT por BTC → vender BTC por USDT</p>
                <p className="mt-1">Lucro bruto = (bid(ALT/BTC) × bid(BTC/USDT)) ÷ ask(ALT/USDT)</p>
              </div>
            </div>
            <p>
              <strong className="text-foreground">Custo mínimo:</strong> 3 trades × 0,1% taker = <span className="text-rose-300 font-semibold">{FEE_HURDLE.toFixed(4)}%</span> de taxas.
              Somente oportunidades com lucro bruto acima desta barreira são lucrativas.
              Na prática, bots HFT eliminam divergências em milissegundos — esta análise mede a estrutura do mercado.
            </p>
          </div>
        </div>
      </section>

      {/* Opportunities table */}
      <section className="cyber-surface mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Oportunidades detectadas</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Spread mínimo detectado: 0,15% bruto. Verde = lucrativo após taxas.
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
                <th>Horário</th>
                <th>Caminho</th>
                <th>Direção</th>
                <th>Bruto</th>
                <th>Taxas</th>
                <th>Líquido</th>
                <th>BTC/USDT</th>
                <th>ALT/BTC</th>
                <th>ALT/USDT</th>
              </tr>
            </thead>
            <tbody>
              {!isLoading && opps.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-sm text-muted-foreground">
                    <ArrowRightLeft className="mx-auto mb-3 h-8 w-8 opacity-20" />
                    <p>Aguardando dados. O bot precisa estar recebendo book tickers.</p>
                    <p className="mt-1 text-xs opacity-60">
                      Se o scanner estiver ativo mas sem resultados, o mercado está eficiente neste momento.
                    </p>
                  </td>
                </tr>
              )}
              {opps.map((o) => {
                const profitable = o.net_pct > 0;
                const near = o.net_pct > -0.15 && o.net_pct <= 0;
                return (
                  <tr
                    key={o.id}
                    className={profitable ? "bg-[#00ff88]/[.03]" : near ? "bg-amber-400/[.03]" : undefined}
                  >
                    <td className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatDateTime(o.detected_at)}
                    </td>
                    <td>
                      <span className={`font-mono text-xs ${profitable ? "text-[#00ff88]" : "text-foreground"}`}>
                        {o.path}
                      </span>
                    </td>
                    <td>
                      <DirectionChip dir={o.direction} />
                    </td>
                    <td>
                      <span className={`tabular-nums text-sm font-medium ${o.gross_pct > FEE_HURDLE ? "text-[#00ff88]" : "text-foreground"}`}>
                        +{o.gross_pct.toFixed(4)}%
                      </span>
                    </td>
                    <td className="text-rose-400 tabular-nums text-sm">
                      -{o.fees_pct.toFixed(4)}%
                    </td>
                    <td>
                      <NetBadge pct={o.net_pct} />
                    </td>
                    <td className="tabular-nums text-sm text-muted-foreground">
                      {o.btc_usdt_price.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="tabular-nums text-sm text-muted-foreground">
                      {o.alt_btc_price.toFixed(8)}
                    </td>
                    <td className="tabular-nums text-sm text-muted-foreground">
                      {o.alt_usdt_price < 1
                        ? o.alt_usdt_price.toFixed(6)
                        : o.alt_usdt_price.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Legend */}
      <section className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="cyber-surface p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Legenda</p>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#00ff88]" /> Lucrativo (líq. &gt; 0%)</div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400" /> Próximo (líq. &gt; −0,15%)</div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-rose-400" /> Não lucrativo após taxas</div>
          </div>
        </div>
        <div className="cyber-surface p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Barreira de taxas</p>
          <p className="text-xs text-muted-foreground leading-5">
            Cada trade cobra 0,1% de taker. Com 3 trades, a barreira é <strong className="text-foreground">0,3003%</strong> bruto
            para qualquer lucro líquido. Com BNB ativo (0,075%), a barreira cai para 0,2251%.
          </p>
        </div>
        <div className="cyber-surface p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Limites práticos</p>
          <p className="text-xs text-muted-foreground leading-5">
            Oportunidades reais duram &lt;5ms. O sistema as detecta para análise estatística
            — entender quais pares têm mais divergência estrutural ajuda a calibrar os gatilhos
            do momentum scanner.
          </p>
        </div>
      </section>
    </div>
  );
}
