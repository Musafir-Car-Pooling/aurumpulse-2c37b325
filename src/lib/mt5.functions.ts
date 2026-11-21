import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scanMarket } from "./market-data";
import type { Json } from "@/integrations/supabase/types";
import { autoEntries, canTrade, hashKey, lotForConfidence, newKey } from "./mt5";

const marketEnum = z.enum(["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "BTCUSD"]);

export const getMt5Link = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("mt5_links").select("created_at,last_seen,auto_trade,auto_markets").eq("user_id", context.userId).maybeSingle();
    if (error) throw error;
    return data;
  });

export const createMt5Key = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = newKey();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("mt5_links").upsert({ user_id: context.userId, key_hash: await hashKey(key), created_at: new Date().toISOString(), last_seen: null });
    if (error) throw new Error("Could not create key");
    return { key };
  });

export const revokeMt5Key = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("mt5_links").delete().eq("user_id", context.userId);
    return { ok: true };
  });

export const setAutoTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ on: z.boolean(), markets: z.array(marketEnum).optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("mt5_links").select("auto_markets").eq("user_id", context.userId).maybeSingle();
    if (!row) throw new Error("MT5_NOT_CONNECTED");
    const markets = data.markets ?? row.auto_markets;
    const { error } = await context.supabase.rpc("save_auto_trade_settings", { p_on: data.on, p_markets: markets });
    if (error) throw error;
    return { on: data.on, markets };
  });

export const placeMt5Order = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ market: marketEnum }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: link } = await context.supabase.from("mt5_links").select("user_id").eq("user_id", context.userId).maybeSingle();
    if (!link) throw new Error("MT5_NOT_CONNECTED");
    const scan = await scanMarket(data.market);
    const s = scan.result;
    if (!s || !canTrade(s)) throw new Error("NO_LIVE_SIGNAL");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("trade_orders").insert({
      user_id: context.userId, market: data.market, direction: s.direction, lot: lotForConfidence(s.confidence),
      signal: { entry: s.entry, stopLoss: s.stopLoss, tp1: s.tp1, tp2: s.tp2, time: s.time, validUntil: s.validUntil },
    }).select("id,direction").single();
    if (error || !row) throw new Error("Could not send order");
    return row;
  });

export const listMt5Orders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("trade_orders").select("id,market,direction,lot,source,status,ticket,price,error,created_at").eq("user_id", context.userId).order("created_at", { ascending: false }).limit(10);
    return data ?? [];
  });

/** Refresh selected markets for this user through the same transactional queue as unattended scans. */
export const refreshAutoTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: link } = await context.supabase.from("mt5_links").select("auto_trade,last_seen,auto_markets").eq("user_id", context.userId).maybeSingle();
    if (!link) throw new Error("MT5_NOT_CONNECTED");
    if (!link.auto_markets.length) throw new Error("SELECT_MARKET");
    const { error: settingsError } = await context.supabase.rpc("save_auto_trade_settings", { p_on: true, p_markets: link.auto_markets });
    if (settingsError) throw settingsError;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const online = !!link.last_seen && Date.now() - new Date(link.last_seen).getTime() < 30000;
    let queued = 0;
    const results: string[] = [];
    for (const candidate of link.auto_markets) {
      const parsed = marketEnum.safeParse(candidate);
      if (!parsed.success) continue;
      const market = parsed.data;
      const scan = await scanMarket(market);
      const { error: recordError } = await supabaseAdmin.rpc("record_market_scan", { p_market: market, p_result: scan.result as unknown as Json, p_status: scan.status, p_scanned_at: scan.scanned_at, ...(scan.error ? { p_error: scan.error } : {}) });
      if (recordError) throw recordError;
      const s = scan.result;
      const entries = scan.status === "ready" ? autoEntries(s) : [];
      for (const e of entries) {
        if (!s) continue;
        const { data: count, error } = await supabaseAdmin.rpc("queue_selected_auto_orders", { p_user_id: context.userId, p_market: market, p_direction: e.direction,
          p_signal: { lot: lotForConfidence(e.confidence), kind: e.kind, setup: e.setup ?? null, confidence: e.confidence, entry: s.entry, time: s.time, validUntil: s.validUntil } });
        if (error) throw error;
        queued += count ?? 0;
      }
      results.push(`${market}: ${scan.status === "ready" ? entries.map(e => e.direction).join(" + ") || "WAIT" : scan.status}`);
    }
    return { queued, online, summary: `${results.join(" · ")}. ${queued} new entries queued.` };
  });

/** Bot status box: latest gold trend + retracement signal and the latest auto entries with their outcome. */
export const getBotStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: link } = await context.supabase.from("mt5_links").select("auto_markets").eq("user_id", context.userId).maybeSingle();
    const market = marketEnum.safeParse(link?.auto_markets[0]);
    const selected = market.success ? market.data : "XAUUSD";
    const { data: scan } = await context.supabase.from("market_scans").select("result,status,scanned_at").eq("market", selected).maybeSingle();
    const r = (scan?.result ?? null) as { direction?: string; confidence?: number; scalp?: { direction: string; confidence: number; retracement: boolean; reasons: string[]; kind?: string; session?: string } | null } | null;
    const { data: orders } = await context.supabase.from("trade_orders").select("direction,lot,status,error,created_at").eq("user_id", context.userId).eq("market", selected).eq("source", "auto").order("created_at", { ascending: false }).limit(3);
    return { market: selected, status: scan?.status ?? "unavailable", scannedAt: scan?.scanned_at ?? null, trend: r?.direction ?? "WAIT", trendConf: r?.confidence ?? 0,
      scalp: r?.scalp?.direction ?? "WAIT", scalpConf: r?.scalp?.confidence ?? 0, retracement: !!r?.scalp?.retracement, reasons: r?.scalp?.reasons ?? [], session: r?.scalp?.session ?? "", setup: r?.scalp?.kind ?? "", orders: orders ?? [] };
  });
