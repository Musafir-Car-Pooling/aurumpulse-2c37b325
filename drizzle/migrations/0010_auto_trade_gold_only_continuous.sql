CREATE OR REPLACE FUNCTION public.queue_auto_orders(p_market text, p_direction text, p_signal jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF p_market <> 'XAUUSD' OR p_direction NOT IN ('BUY','SELL') THEN RETURN 0; END IF;
  INSERT INTO public.trade_orders(user_id, market, direction, lot, signal, source)
  SELECT l.user_id, p_market, p_direction, 0.01, p_signal, 'auto'
  FROM public.mt5_links l
  WHERE l.auto_trade AND public.has_signal_access(l.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.trade_orders o WHERE o.user_id = l.user_id AND o.market = p_market
      AND o.source = 'auto' AND o.status IN ('pending','sent'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;