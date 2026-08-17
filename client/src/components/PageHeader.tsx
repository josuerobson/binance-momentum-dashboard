import type { ReactNode } from "react";

export function PageHeader({ eyebrow = "OPERAÇÃO EM TEMPO REAL", title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-col gap-4 border-b border-white/[0.07] pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="mb-2 text-[10px] font-semibold tracking-[0.22em] text-[#00ff88]">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}
