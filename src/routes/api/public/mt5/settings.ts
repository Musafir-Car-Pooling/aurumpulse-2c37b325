import { createFileRoute } from "@tanstack/react-router";
import { hashKey } from "@/lib/mt5";
import { marketIds } from "@/lib/markets";

export const Route = createFileRoute("/api/public/mt5/settings")({
  server: { handlers: { GET: async ({ request }) => {
    const key = request.headers.get("x-ap-key") ?? "";
    if (!/^ap_[0-9a-f]{48}$/.test(key)) return new Response("Unauthorized", { status: 401 });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link, error } = await supabaseAdmin.from("mt5_links").select("auto_trade,auto_markets").eq("key_hash", await hashKey(key)).maybeSingle();
    if (error) return new Response("Unavailable", { status: 503 });
    if (!link) return new Response("Unauthorized", { status: 401 });
    const markets = link.auto_markets.filter(m => marketIds.some(id => id === m));
    return new Response(`${link.auto_trade ? 1 : 0}|${markets.join(",")}`, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } } },
});