ALTER TABLE public.market_scans DROP CONSTRAINT market_scans_market_check;
ALTER TABLE public.market_scans ADD CONSTRAINT market_scans_market_check CHECK (market IN ('XAUUSD','EURUSD','GBPUSD','USDJPY','USDCHF','USTECm','USTEC_x100m'));
ALTER TABLE public.signal_alerts DROP CONSTRAINT signal_alerts_market_check;
ALTER TABLE public.signal_alerts ADD CONSTRAINT signal_alerts_market_check CHECK (market IN ('XAUUSD','EURUSD','GBPUSD','USDJPY','USDCHF','USTECm','USTEC_x100m'));
COMMENT ON CONSTRAINT market_scans_market_check ON public.market_scans IS 'USTEC variants retained for historical rows only; active market registry excludes them.';
COMMENT ON CONSTRAINT signal_alerts_market_check ON public.signal_alerts IS 'USTEC variants retained for historical rows only; active market registry excludes them.';
ALTER TABLE public.mt5_links DROP CONSTRAINT mt5_links_auto_markets_check;
UPDATE public.mt5_links SET auto_markets=ARRAY(SELECT m FROM unnest(auto_markets) m WHERE m IN ('XAUUSD','EURUSD','GBPUSD','USDJPY','USDCHF'));
ALTER TABLE public.mt5_links ADD CONSTRAINT mt5_links_auto_markets_check CHECK (auto_markets <@ ARRAY['XAUUSD','EURUSD','GBPUSD','USDJPY','USDCHF']::text[]);
CREATE OR REPLACE FUNCTION public.save_auto_trade_settings(p_on boolean,p_markets text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
 IF p_markets IS NULL OR NOT (p_markets <@ ARRAY['XAUUSD','EURUSD','GBPUSD','USDJPY','USDCHF']::text[]) OR array_position(p_markets,NULL) IS NOT NULL THEN RAISE EXCEPTION 'INVALID_MARKETS'; END IF;
 IF p_on AND cardinality(p_markets)=0 THEN RAISE EXCEPTION 'SELECT_MARKET'; END IF;
 UPDATE public.mt5_links SET auto_trade=p_on,auto_markets=ARRAY(SELECT DISTINCT unnest(p_markets)) WHERE user_id=v_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'MT5_NOT_CONNECTED'; END IF;
 UPDATE public.trade_orders SET status='expired',done_at=now(),error='Auto trading disabled for this pair' WHERE user_id=v_user AND source='auto' AND status='pending' AND (NOT p_on OR NOT (market=ANY(p_markets)));
END $$;
REVOKE ALL ON FUNCTION public.save_auto_trade_settings(boolean,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_auto_trade_settings(boolean,text[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.queue_selected_auto_orders(p_market text,p_direction text,p_signal jsonb,p_user_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer := 0; v_lot numeric := coalesce((p_signal->>'lot')::numeric,0.01); l record;
BEGIN
 IF p_market NOT IN ('XAUUSD','EURUSD','GBPUSD','USDJPY','USDCHF') OR p_direction NOT IN ('BUY','SELL') THEN RETURN 0; END IF;
 IF p_signal->>'validUntil' IS NULL OR (p_signal->>'validUntil')::timestamptz <= now() THEN RETURN 0; END IF;
 IF v_lot NOT IN (0.01,0.02,0.03,0.05) THEN v_lot := 0.01; END IF;
 FOR l IN SELECT user_id FROM public.mt5_links WHERE auto_trade AND p_market=ANY(auto_markets) AND (p_user_id IS NULL OR user_id=p_user_id) AND public.has_signal_access(user_id) FOR UPDATE LOOP
  UPDATE public.trade_orders SET status='expired',done_at=now(),error=coalesce(error,'Not confirmed by MT5 in 3 min') WHERE user_id=l.user_id AND market=p_market AND status IN ('pending','sent') AND created_at < now()-interval '3 minutes';
  IF NOT EXISTS (SELECT 1 FROM public.trade_orders o WHERE o.user_id=l.user_id AND o.market=p_market AND o.direction=p_direction AND o.source='auto' AND o.status IN ('pending','sent')) THEN
   INSERT INTO public.trade_orders(user_id,market,direction,lot,signal,source) VALUES(l.user_id,p_market,p_direction,v_lot,p_signal,'auto');
   n := n+1;
  END IF;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.queue_selected_auto_orders(text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_selected_auto_orders(text,text,jsonb,uuid) TO service_role;