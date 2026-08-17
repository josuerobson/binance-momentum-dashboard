import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

export type PnlPoint = { time: string; pnl: number };

export function useLiveSnapshot() {
  const query = trpc.telemetry.snapshot.useQuery(undefined, { refetchInterval: 3_000, retry: 1 });
  const [history, setHistory] = useState<PnlPoint[]>([]);

  useEffect(() => {
    if (!query.data) return;
    const pnl = query.data.positions.reduce((total, position) => total + (position.pnl_usdt ?? 0), 0);
    setHistory(current => [...current.slice(-39), { time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), pnl }]);
  }, [query.data, query.dataUpdatedAt]);

  return { ...query, history };
}
