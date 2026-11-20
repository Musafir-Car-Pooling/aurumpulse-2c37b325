import { createFileRoute } from "@tanstack/react-router";
import { hashKey, signalLine } from "@/lib/mt5";
import { marketIds } from "@/lib/markets";

// Bridge EA v4 asks for the latest saved live signal of one market (direction|confidence|trend1h|fresh).
export const Route = createFileRoute("/api/public/mt5/signal")({
  server: { handlers: { GET: async ({ request }) => {
    const key = request.headers.get("x-ap-key") ?? "";
    if (!/^ap_[0-9a-f]{48}$/.test(key)) return new Response("Unauthorized", { status: 401 });
    const market = new URL(request.url).searchParams.get("market") ?? "";
    if (!(marketIds as string[]).includes(market)) return new Response("Bad market", { status: 400 });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link } = await supabaseAdmin.from("mt5_links").select("user_id").eq("key_hash", await hashKey(key)).maybeSingle();
    if (!link) return new Response("Unauthorized", { status: 401 });
    const { data } = await supabaseAdmin.from("market_scans").select("result,status").eq("market", market).maybeSingle();
    const line = data?.status === "ready" ? signalLine(data.result as Parameters<typeof signalLine>[0], Date.now(), new URL(request.url).searchParams.get("v") === "2") : "NONE";
    return new Response(line, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } } },
});
