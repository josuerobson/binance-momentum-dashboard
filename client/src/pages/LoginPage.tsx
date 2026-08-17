import { useState } from "react";
import { useLocation } from "wouter";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      setLocation("/");
    },
  });
  return (
    <main className="cyber-grid grid min-h-screen place-items-center p-5">
      <section className="page-enter w-full max-w-md rounded-2xl border border-white/10 bg-[#101727]/95 p-7 shadow-[0_24px_80px_rgba(0,0,0,.45)] backdrop-blur-xl sm:p-9">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.24em] text-[#00ff88]">ACESSO RESTRITO</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Momentum Console</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Autenticação local para o painel operacional do bot.</p>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-[#00ff88]/25 bg-[#00ff88]/10 text-[#00ff88]"><ShieldCheck className="h-5 w-5" /></div>
        </div>
        <form className="space-y-5" onSubmit={event => { event.preventDefault(); login.mutate({ username, password }); }}>
          <div className="space-y-2"><Label htmlFor="username">Usuário</Label><Input id="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="password">Senha</Label><Input id="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></div>
          {login.error && <p role="alert" className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{login.error.message}</p>}
          <Button type="submit" disabled={login.isPending || !username || !password} className="h-11 w-full bg-[#00ff88] font-semibold text-[#07120d] hover:bg-[#46ffac]">
            <LockKeyhole className="mr-2 h-4 w-4" />{login.isPending ? "Validando acesso…" : "Entrar no console"}
          </Button>
        </form>
        <p className="mt-6 border-t border-white/[0.07] pt-5 text-xs leading-5 text-muted-foreground">No primeiro acesso, use o usuário <strong className="font-medium text-foreground">admin</strong> e a senha definida em <code className="text-[#00ff88]">DASHBOARD_ADMIN_PASSWORD</code>.</p>
      </section>
    </main>
  );
}
