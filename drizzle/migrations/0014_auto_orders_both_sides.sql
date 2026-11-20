CREATE OR REPLACE FUNCTION public.queue_auto_orders(p_market text, p_direction text, p_signal jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n integer; v_lot numeric := coalesce((p_signal->>'lot')::numeric, 0.01);
BEGIN
  IF p_market <> 'XAUUSD' OR p_direction NOT IN ('BUY','SELL') THEN RETURN 0; END IF;
  IF v_lot NOT IN (0.01, 0.02, 0.03, 0.05) THEN v_lot := 0.01; END IF;
  UPDATE public.trade_orders SET status='expired', error=coalesce(error,'Not confirmed by MT5 in 3 min')
   WHERE market=p_market AND status IN ('pending','sent') AND created_at < now() - interval '3 minutes';
  INSERT INTO public.trade_orders(user_id, market, direction, lot, signal, source)
  SELECT l.user_id, p_market, p_direction, v_lot, p_signal, 'auto'
  FROM public.mt5_links l
  WHERE l.auto_trade AND public.has_signal_access(l.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.trade_orders o WHERE o.user_id = l.user_id AND o.market = p_market
      AND o.direction = p_direction AND o.source = 'auto' AND o.status IN ('pending','sent'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.claim_mt5_order_v2(p_key_hash text)
 RETURNS TABLE(id uuid, market text, direction text, lot numeric, signal jsonb)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_user uuid;
BEGIN
  UPDATE public.mt5_links SET last_seen = now() WHERE key_hash = p_key_hash RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN RAISE EXCEPTION 'INVALID_KEY'; END IF;
  UPDATE public.trade_orders o SET status='expired', done_at=now() WHERE o.user_id=v_user AND o.status='pending' AND o.created_at < now() - interval '3 minutes';
  RETURN QUERY UPDATE public.trade_orders o SET status='sent', sent_at=now()
    WHERE o.id = (SELECT t.id FROM public.trade_orders t WHERE t.user_id=v_user AND t.status='pending' ORDER BY t.created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING o.id, o.market, o.direction, o.lot, o.signal;
END $function$;