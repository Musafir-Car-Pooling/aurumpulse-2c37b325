import { createFileRoute } from "@tanstack/react-router";
import bridgeSource from "@/mt5/AurumPulse_Bridge_EA_v19.mq5?raw";

export const Route = createFileRoute("/api/public/mt5/bridge")({
  server: { handlers: { GET: () => new Response(bridgeSource, { headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": 'attachment; filename="AurumPulse_Bridge_EA_v19.mq5"',
    "Cache-Control": "no-store",
  } }) } },
});