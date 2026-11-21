import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { getMt5Link, refreshAutoTrade, setAutoTrade } from "@/lib/mt5.functions";
import { marketIds, type Market } from "@/lib/markets";

export function AutoTradeControls() {
  const read = useServerFn(getMt5Link), save = useServerFn(setAutoTrade), refresh = useServerFn(refreshAutoTrade);
  const [link, setLink] = useState<Awaited<ReturnType<typeof getMt5Link>>>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const load = useCallback(() => read().then(setLink).catch(() => setLink(null)), [read]);
  useEffect(() => { void load(); const id = setInterval(() => void load(), 5000); return () => clearInterval(id); }, [load]);
  if (!link) return null;
  const selected = link.auto_markets.filter((m): m is Market => marketIds.some(id => id === m));
  const update = async (on: boolean, markets: Market[]) => {
    setBusy(true); setMessage("");
    try {
      await save({ data: { on, markets } });
      await load();
      setMessage(on ? `Auto trade: ${markets.join(", ")}.` : "Auto trade is off.");
      if (on) {
        try {
          const result = await refresh();
          setMessage(`${result.summary}${result.online ? "" : " MT5 bot offline — check MT5."}`);
        } catch { setMessage("Auto trade saved. Market refresh unavailable — the background scanner will retry."); }
      }
    } catch { setMessage("Could not save auto trade. Try again."); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 border-y border-border py-4" aria-label="Auto trading pairs">
    <div className="flex items-center justify-between gap-3">
      <div><p className="font-semibold">Auto trade</p><p className="text-xs text-muted-foreground">{link.auto_trade ? selected.join(" · ") : "Off — manual entries only"}</p></div>
      <Switch aria-label="Auto trade" checked={link.auto_trade} disabled={busy || !selected.length} onCheckedChange={on => void update(on, selected)} />
    </div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {marketIds.map(m => <label key={m} className="flex min-h-9 items-center gap-2 text-sm font-mono">
        <Checkbox aria-label={`Auto trade ${m}`} checked={selected.includes(m)} disabled={busy} onCheckedChange={checked => {
          const next = checked === true ? [...selected, m] : selected.filter(id => id !== m);
          void update(link.auto_trade && next.length > 0, next);
        }} />{m}
      </label>)}
    </div>
    <Button variant="outline" className="w-full" disabled={busy || !selected.length} onClick={async () => {
      setBusy(true); setMessage("");
      try { const result = await refresh(); await load(); setMessage(`${result.summary}${result.online ? "" : " MT5 bot offline — check MT5."}`); }
      catch { setMessage("Could not refresh auto trade. Try again."); }
      finally { setBusy(false); }
    }}><RefreshCw className={busy ? "animate-spin motion-reduce:animate-none" : ""} />Refresh auto trade</Button>
    {message && <p role="status" className="text-xs text-gold">{message}</p>}
  </section>;
}