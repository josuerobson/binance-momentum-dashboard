import { useState } from "react";
import {
  Bot, CheckCircle2, ChevronDown, ChevronRight, Cpu, FlaskConical,
  Loader2, Plus, Save, Settings2, Sparkles, Trash2, XCircle, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProviderType = "claude" | "openai" | "gemini";

type Provider = {
  id: number;
  name: string;
  type: ProviderType;
  baseUrl: string | null;
  model: string;
  enabled: boolean;
  createdAt: number;
  keyPreview: string;
};

// ─── Defaults per type ────────────────────────────────────────────────────────

const TYPE_DEFAULTS: Record<ProviderType, { model: string; baseUrl: string; placeholder: string }> = {
  claude: {
    model: "claude-haiku-4-5-20251001",
    baseUrl: "https://api.anthropic.com",
    placeholder: "sk-ant-api03-...",
  },
  openai: {
    model: "gpt-4o-mini",
    baseUrl: "",
    placeholder: "sk-... ou tp-...",
  },
  gemini: {
    model: "gemini-1.5-flash",
    baseUrl: "",
    placeholder: "AIza...",
  },
};

const TYPE_LABELS: Record<ProviderType, string> = {
  claude: "Anthropic Claude",
  openai: "OpenAI-compatible",
  gemini: "Google Gemini",
};

const TYPE_COLORS: Record<ProviderType, string> = {
  claude: "text-[#e07f5a] border-[#e07f5a]/30 bg-[#e07f5a]/10",
  openai: "text-[#7db3ff] border-[#7db3ff]/30 bg-[#7db3ff]/10",
  gemini: "text-[#a78bfa] border-[#a78bfa]/30 bg-[#a78bfa]/10",
};

const FUNCTION_LABELS: Record<string, { label: string; description: string; icon: typeof Sparkles }> = {
  experiment_advisor: {
    label: "Advisor de Experimentos",
    description: "Sugere configs para os slots paralelos. Todos os provedores atribuídos recebem um slot.",
    icon: FlaskConical,
  },
  market_analysis: {
    label: "Análise de Mercado",
    description: "Analisa paper trades e propõe ajustes de parâmetros. Usa o primeiro provedor atribuído.",
    icon: Cpu,
  },
};

// ─── Provider form ─────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
};

const emptyForm = (): FormState => ({
  name: "",
  type: "claude",
  apiKey: "",
  baseUrl: "",
  model: "claude-haiku-4-5-20251001",
  enabled: true,
});

function fromProvider(p: Provider): FormState {
  return {
    name: p.name,
    type: p.type,
    apiKey: "",
    baseUrl: p.baseUrl ?? "",
    model: p.model,
    enabled: p.enabled,
  };
}

function ProviderForm({
  initial,
  onSave,
  onCancel,
  isNew,
}: {
  initial: FormState;
  onSave: (f: FormState) => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);

  const set = (k: keyof FormState, v: string | boolean) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const handleTypeChange = (t: ProviderType) => {
    const d = TYPE_DEFAULTS[t];
    setForm(prev => ({
      ...prev,
      type: t,
      model: d.model,
      baseUrl: d.baseUrl,
    }));
  };

  const inputCls =
    "w-full rounded-md border border-white/[.12] bg-white/[.04] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#00ff88]/40 focus:outline-none focus:ring-1 focus:ring-[#00ff88]/20";

  return (
    <div className="space-y-4 rounded-xl border border-white/[.09] bg-white/[.02] p-5">
      <p className="text-sm font-semibold text-foreground">
        {isNew ? "Novo provedor" : "Editar provedor"}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Name */}
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Nome do provedor
          </label>
          <input
            className={inputCls}
            placeholder="Ex: Claude Haiku, MIMO, Gemini Flash"
            value={form.name}
            onChange={e => set("name", e.target.value)}
          />
        </div>

        {/* Type */}
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Tipo / protocolo
          </label>
          <select
            className={inputCls}
            value={form.type}
            onChange={e => handleTypeChange(e.target.value as ProviderType)}
          >
            {(Object.keys(TYPE_LABELS) as ProviderType[]).map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {/* API Key */}
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            API Key {!isNew && <span className="text-amber-400/70">(deixe vazio para não alterar)</span>}
          </label>
          <input
            type="password"
            className={inputCls}
            placeholder={TYPE_DEFAULTS[form.type].placeholder}
            value={form.apiKey}
            onChange={e => set("apiKey", e.target.value)}
            autoComplete="new-password"
          />
        </div>

        {/* Model */}
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Modelo
          </label>
          <input
            className={inputCls}
            placeholder="claude-haiku-4-5-20251001 / gpt-4o-mini / gemini-1.5-flash"
            value={form.model}
            onChange={e => set("model", e.target.value)}
          />
        </div>

        {/* Base URL (only for claude + openai) */}
        {form.type !== "gemini" && (
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              Base URL
              {form.type === "claude" && (
                <span className="ml-1 text-muted-foreground/60">(padrão: https://api.anthropic.com)</span>
              )}
              {form.type === "openai" && (
                <span className="ml-1 text-muted-foreground/60">(ex: https://token-plan-sgp.xiaomimimo.com/v1)</span>
              )}
            </label>
            <input
              className={inputCls}
              placeholder={form.type === "claude" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
              value={form.baseUrl}
              onChange={e => set("baseUrl", e.target.value)}
            />
          </div>
        )}

        {/* Enabled */}
        <div className="flex items-center gap-2.5 sm:col-span-2">
          <input
            type="checkbox"
            id="p-enabled"
            checked={form.enabled}
            onChange={e => set("enabled", e.target.checked)}
            className="h-4 w-4 accent-[#00ff88]"
          />
          <label htmlFor="p-enabled" className="cursor-pointer text-sm text-foreground">
            Ativado — disponível para atribuição a funções
          </label>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="gap-1.5 bg-[#00ff88] text-black text-xs hover:bg-[#00ff88]/90"
          onClick={() => onSave(form)}
          disabled={!form.name.trim() || (isNew && !form.apiKey.trim())}
        >
          <Save className="h-3.5 w-3.5" />
          Salvar
        </Button>
        <Button size="sm" variant="outline" className="text-xs" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Provider card ─────────────────────────────────────────────────────────────

type TestResult = { ok: boolean; latency_ms: number; message: string };

function ProviderCard({
  provider,
  onEdit,
  onDeleted,
}: {
  provider: Provider;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const testMutation = trpc.aiIntegration.testProvider.useMutation({
    onSuccess: r => setTestResult(r),
    onError: e => setTestResult({ ok: false, latency_ms: 0, message: e.message }),
  });

  const toggleMutation = trpc.aiIntegration.updateProvider.useMutation({
    onSuccess: () => onDeleted(), // refetch via parent
    onError: e => toast.error(e.message),
  });

  const deleteMutation = trpc.aiIntegration.deleteProvider.useMutation({
    onSuccess: () => { toast.success("Provedor removido."); onDeleted(); },
    onError: e => toast.error(e.message),
  });

  const colorCls = TYPE_COLORS[provider.type];

  return (
    <article className={`cyber-surface overflow-hidden transition-opacity ${!provider.enabled ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-sm font-semibold text-foreground">{provider.name}</p>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${colorCls}`}>
              {TYPE_LABELS[provider.type]}
            </span>
            {!provider.enabled && (
              <span className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">
                desativado
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            className="rounded p-1.5 text-muted-foreground hover:bg-white/[.06] hover:text-foreground transition-colors"
            title="Editar"
            onClick={onEdit}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded p-1.5 text-rose-400/60 hover:bg-rose-400/10 hover:text-rose-400 transition-colors"
            title="Excluir"
            onClick={() => {
              if (confirm(`Excluir provedor "${provider.name}"?`)) deleteMutation.mutate({ id: provider.id });
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-white/[.06] px-4 pb-3 pt-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Modelo</span>
          <span className="font-mono text-foreground">{provider.model}</span>
        </div>
        {provider.baseUrl && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Endpoint</span>
            <span className="max-w-[180px] truncate text-right font-mono text-foreground">{provider.baseUrl}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Chave</span>
          <span className="font-mono text-muted-foreground">{provider.keyPreview}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-white/[.06] px-4 py-3">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-[11px]"
          disabled={testMutation.isPending}
          onClick={() => { setTestResult(null); testMutation.mutate({ id: provider.id }); }}
        >
          {testMutation.isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Zap className="h-3 w-3" />}
          Testar
        </Button>

        <button
          className={`ml-auto flex items-center gap-1.5 text-[11px] transition-colors ${provider.enabled ? "text-[#00ff88] hover:text-[#00ff88]/70" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => toggleMutation.mutate({ id: provider.id, enabled: !provider.enabled })}
          disabled={toggleMutation.isPending}
        >
          {provider.enabled ? "Ativo" : "Inativo"}
        </button>
      </div>

      {testResult && (
        <div className={`border-t px-4 py-2.5 text-[11px] ${testResult.ok ? "border-[#00ff88]/20 bg-[#00ff88]/5" : "border-rose-500/20 bg-rose-500/5"}`}>
          <div className="flex items-center gap-1.5">
            {testResult.ok
              ? <CheckCircle2 className="h-3.5 w-3.5 text-[#00ff88]" />
              : <XCircle className="h-3.5 w-3.5 text-rose-400" />}
            <span className={testResult.ok ? "text-[#00ff88]" : "text-rose-400"}>
              {testResult.ok ? `OK · ${testResult.latency_ms}ms` : "Falhou"}
            </span>
          </div>
          <p className="mt-0.5 leading-relaxed text-muted-foreground">{testResult.message}</p>
        </div>
      )}
    </article>
  );
}

// ─── Assignment row ────────────────────────────────────────────────────────────

function AssignmentRow({
  functionId,
  meta,
  providers,
  currentIds,
  onSave,
}: {
  functionId: string;
  meta: { label: string; description: string; icon: typeof Sparkles };
  providers: Provider[];
  currentIds: number[];
  onSave: (ids: number[]) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(currentIds));
  const [expanded, setExpanded] = useState(false);
  const Icon = meta.icon;

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const assignedNames = providers
    .filter(p => selected.has(p.id))
    .map(p => p.name);

  return (
    <div className="border-b border-white/[.07] last:border-0">
      <button
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-white/[.02] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{meta.label}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{meta.description}</p>
        </div>
        <div className="shrink-0 text-right">
          {assignedNames.length === 0 ? (
            <span className="text-[11px] text-amber-400">Nenhum atribuído</span>
          ) : (
            <span className="text-[11px] text-[#00ff88]">{assignedNames.join(", ")}</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/[.07] bg-white/[.01] px-5 py-4">
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum provedor cadastrado. Adicione um acima.</p>
          ) : (
            <div className="space-y-2">
              {providers.map(p => (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/[.07] p-3 hover:bg-white/[.03] transition-colors">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    className="h-4 w-4 accent-[#00ff88]"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                      <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_COLORS[p.type]}`}>
                        {TYPE_LABELS[p.type]}
                      </span>
                      {!p.enabled && (
                        <span className="text-[10px] text-muted-foreground">(inativo)</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{p.model}</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5 bg-[#00ff88] text-black text-xs hover:bg-[#00ff88]/90"
              onClick={() => { onSave(Array.from(selected)); setExpanded(false); }}
            >
              <Save className="h-3.5 w-3.5" />
              Salvar atribuição
            </Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setExpanded(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AIIntegrationPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: providerList, refetch: refetchProviders, isLoading: providersLoading } =
    trpc.aiIntegration.listProviders.useQuery(undefined, { refetchInterval: 30_000 });

  const { data: assignmentsData, refetch: refetchAssignments } =
    trpc.aiIntegration.getAssignments.useQuery();

  const addMutation = trpc.aiIntegration.addProvider.useMutation({
    onSuccess: () => { toast.success("Provedor adicionado."); setShowAddForm(false); refetchProviders(); },
    onError: e => toast.error(e.message),
  });

  const updateMutation = trpc.aiIntegration.updateProvider.useMutation({
    onSuccess: () => { toast.success("Provedor atualizado."); setEditingId(null); refetchProviders(); },
    onError: e => toast.error(e.message),
  });

  const assignMutation = trpc.aiIntegration.setAssignment.useMutation({
    onSuccess: () => { toast.success("Atribuição salva."); refetchAssignments(); },
    onError: e => toast.error(e.message),
  });

  const providers = providerList ?? [];
  const assignments = assignmentsData?.assignments ?? {};
  const functions = assignmentsData?.functions ?? {};

  const handleAdd = (form: FormState) => {
    addMutation.mutate({
      name: form.name,
      type: form.type,
      apiKey: form.apiKey,
      baseUrl: form.baseUrl || null,
      model: form.model,
      enabled: form.enabled,
    });
  };

  const handleUpdate = (id: number, form: FormState) => {
    updateMutation.mutate({
      id,
      name: form.name,
      type: form.type,
      apiKey: form.apiKey || undefined,
      baseUrl: form.baseUrl || null,
      model: form.model,
      enabled: form.enabled,
    });
  };

  const editingProvider = editingId !== null ? providers.find(p => p.id === editingId) : null;

  return (
    <div className="page-enter">
      <PageHeader
        title="Integração IA"
        description="Configure provedores de IA e defina qual provedor é usado em cada funcionalidade do sistema."
        action={
          <div className="status-chip status-ok">
            <Sparkles className="h-3.5 w-3.5" />
            {providers.filter(p => p.enabled).length} ativo{providers.filter(p => p.enabled).length !== 1 ? "s" : ""}
          </div>
        }
      />

      {/* ── Providers ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Provedores de IA</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Cada provedor representa uma conta de API com credenciais próprias.
            </p>
          </div>
          {!showAddForm && editingId === null && (
            <Button
              size="sm"
              className="gap-1.5 bg-[#00ff88] text-black text-xs hover:bg-[#00ff88]/90"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Novo provedor
            </Button>
          )}
        </div>

        {showAddForm && (
          <ProviderForm
            initial={emptyForm()}
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            isNew
          />
        )}

        {providersLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando provedores…
          </div>
        )}

        {!providersLoading && providers.length === 0 && !showAddForm && (
          <div className="cyber-surface flex min-h-[120px] items-center justify-center rounded-xl">
            <div className="text-center">
              <Bot className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Nenhum provedor cadastrado ainda.</p>
              <button
                className="mt-2 text-xs text-[#00ff88] hover:underline"
                onClick={() => setShowAddForm(true)}
              >
                Adicionar o primeiro
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map(p =>
            editingId === p.id && editingProvider ? (
              <div key={p.id} className="sm:col-span-2 xl:col-span-3">
                <ProviderForm
                  initial={fromProvider(editingProvider)}
                  onSave={form => handleUpdate(p.id, form)}
                  onCancel={() => setEditingId(null)}
                  isNew={false}
                />
              </div>
            ) : (
              <ProviderCard
                key={p.id}
                provider={p}
                onEdit={() => { setEditingId(p.id); setShowAddForm(false); }}
                onDeleted={() => { refetchProviders(); refetchAssignments(); }}
              />
            )
          )}
        </div>
      </section>

      {/* ── Function assignments ────────────────────────────────────────── */}
      <section className="cyber-surface mt-8 overflow-hidden">
        <div className="border-b border-white/[.07] px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Atribuição por funcionalidade</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Escolha qual provedor cada funcionalidade do sistema usará. Clique para expandir e configurar.
          </p>
        </div>

        {Object.entries(FUNCTION_LABELS).map(([fnId, meta]) => (
          <AssignmentRow
            key={fnId}
            functionId={fnId}
            meta={meta}
            providers={providers}
            currentIds={assignments[fnId] ?? []}
            onSave={ids => assignMutation.mutate({ functionId: fnId as "market_analysis" | "experiment_advisor", providerIds: ids })}
          />
        ))}
      </section>

      {/* ── Tips ────────────────────────────────────────────────────────── */}
      <section className="mt-6 grid gap-3 sm:grid-cols-3 text-[11px] text-muted-foreground">
        <div className="rounded-lg border border-white/[.06] bg-white/[.01] p-3">
          <p className="mb-1 font-semibold text-foreground">Claude (Anthropic)</p>
          URL padrão: <code className="text-[#e07f5a]">https://api.anthropic.com</code>.<br />
          Chaves começam com <code>sk-ant-</code>.
        </div>
        <div className="rounded-lg border border-white/[.06] bg-white/[.01] p-3">
          <p className="mb-1 font-semibold text-foreground">OpenAI-compatible (MIMO, etc.)</p>
          Configure a Base URL do seu provedor.<br />
          MIMO: <code className="text-[#7db3ff]">https://token-plan-sgp.xiaomimimo.com/v1</code>
        </div>
        <div className="rounded-lg border border-white/[.06] bg-white/[.01] p-3">
          <p className="mb-1 font-semibold text-foreground">Gemini (Google)</p>
          Chaves obtidas no Google AI Studio.<br />
          Formato: <code className="text-[#a78bfa]">AIzaSy...</code>. Sem Base URL necessária.
        </div>
      </section>
    </div>
  );
}
