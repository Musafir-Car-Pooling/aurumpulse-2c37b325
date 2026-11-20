import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scanMarket } from "./market-data";
import type { Json } from "@/integrations/supabase/types";
import { autoEntries, canTrade, hashKey, lotForConfidence, newKey } from "./mt5";

const marketEnum = z.enum(["XAUUSD", "USTECm", "USTEC_x100m", "EURUSD", "GBPUSD", "USDJPY"]);

export const getMt5Link = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("mt5_links").select("created_at,last_seen,auto_trade").eq("user_id", context.userId).maybeSingle();
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
  .inputValidator((i: unknown) => z.object({ on: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("mt5_links").update({ auto_trade: data.on }).eq("user_id", context.userId).select("auto_trade").maybeSingle();
    if (error) throw new Error("Could not save");
    if (!row) throw new Error("MT5_NOT_CONNECTED");
    return { on: row.auto_trade };
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

/** Refresh button: clears stuck auto orders, rescans gold now and queues an entry if the live signal is tradable. */
export const refreshAutoTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: link } = await context.supabase.from("mt5_links").select("auto_trade,last_seen").eq("user_id", context.userId).maybeSingle();
    if (!link) throw new Error("MT5_NOT_CONNECTED");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("trade_orders").update({ status: "expired", error: "Cleared by refresh" }).eq("user_id", context.userId).in("status", ["pending", "sent"]).lt("created_at", new Date(Date.now() - 60000).toISOString());
    if (!link.auto_trade) await supabaseAdmin.from("mt5_links").update({ auto_trade: true }).eq("user_id", context.userId);
    const scan = await scanMarket("XAUUSD");
    await supabaseAdmin.rpc("record_market_scan", { p_market: "XAUUSD", p_result: scan.result as unknown as Json, p_status: scan.status, p_scanned_at: scan.scanned_at, ...(scan.error ? { p_error: scan.error } : {}) });
    const s = scan.result;
    const online = !!link.last_seen && Date.now() - new Date(link.last_seen).getTime() < 30000;
    const entries = scan.status === "ready" ? autoEntries(s) : [];
    if (!s || !entries.length) return { queued: false, direction: s?.direction ?? "WAIT", online };
    let queued = 0;
    for (const e of entries) {
      const { data: open } = await supabaseAdmin.from("trade_orders").select("id").eq("user_id", context.userId).eq("market", "XAUUSD").eq("direction", e.direction).in("status", ["pending", "sent"]).limit(1);
      if (open?.length) continue;
      const { error } = await supabaseAdmin.from("trade_orders").insert({ user_id: context.userId, market: "XAUUSD", direction: e.direction, lot: lotForConfidence(e.confidence), source: "auto",
        signal: { kind: e.kind, setup: e.setup ?? null, confidence: e.confidence, entry: s.entry, time: s.time, validUntil: s.validUntil } });
      if (!error) queued++;
    }
    if (!queued) return { queued: false, direction: entries.map(e => e.direction).join("+"), online, waiting: true };
    return { queued: true, direction: entries.map(e => `${e.direction}${e.kind === "scalp" ? " (retracement)" : ""}`).join(" + "), online };
  });

/** Bot status box: latest gold trend + retracement signal and the latest auto entries with their outcome. */
export const getBotStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: scan } = await supabaseAdmin.from("market_scans").select("result,status,scanned_at").eq("market", "XAUUSD").maybeSingle();
    const r = (scan?.result ?? null) as { direction?: string; confidence?: number; scalp?: { direction: string; confidence: number; retracement: boolean; reasons: string[]; kind?: string; session?: string } | null } | null;
    const { data: orders } = await context.supabase.from("trade_orders").select("direction,lot,status,error,created_at").eq("user_id", context.userId).eq("market", "XAUUSD").eq("source", "auto").order("created_at", { ascending: false }).limit(3);
    return { status: scan?.status ?? "unavailable", scannedAt: scan?.scanned_at ?? null, trend: r?.direction ?? "WAIT", trendConf: r?.confidence ?? 0,
      scalp: r?.scalp?.direction ?? "WAIT", scalpConf: r?.scalp?.confidence ?? 0, retracement: !!r?.scalp?.retracement, reasons: r?.scalp?.reasons ?? [], session: r?.scalp?.session ?? "", setup: r?.scalp?.kind ?? "", orders: orders ?? [] };
  });
