-- Execute with a privileged SQL test runner. Everything is rolled back;
-- these isolated connection IDs have no broker or authentication account.
BEGIN;
DO $$
DECLARE
 a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
 ka text := gen_random_uuid()::text; kb text := gen_random_uuid()::text;
 s jsonb := jsonb_build_object('lot',0.02,'validUntil',now()+interval '1 hour');
 n integer; manual_id uuid; auto_id uuid;
BEGIN
 INSERT INTO public.mt5_links(user_id,key_hash,auto_trade,auto_markets)
 VALUES(a,ka,true,ARRAY['EURUSD','USDCHF']), (b,kb,true,ARRAY['GBPUSD']);

 IF public.queue_selected_auto_orders('EURUSD','BUY',s,a) <> 1 THEN
  RAISE EXCEPTION 'Selected EURUSD BUY must queue'; END IF;
 IF public.queue_selected_auto_orders('USDCHF','SELL',s,a) <> 1 THEN
  RAISE EXCEPTION 'Selected USDCHF SELL must queue'; END IF;
 IF public.queue_selected_auto_orders('XAUUSD','BUY',s,a) <> 0 THEN
  RAISE EXCEPTION 'Unselected gold must not queue'; END IF;
 IF public.queue_selected_auto_orders('EURUSD','BUY',s,b) <> 0 THEN
  RAISE EXCEPTION 'Other user selection must not be bypassed'; END IF;
 SELECT count(*) INTO n FROM public.trade_orders WHERE user_id=b;
 IF n <> 0 THEN RAISE EXCEPTION 'User refresh must not queue another user'; END IF;

 IF public.queue_selected_auto_orders('EURUSD','BUY',s,a) <> 0 THEN
  RAISE EXCEPTION 'Repeated pending same-direction order must deduplicate'; END IF;
 IF public.queue_selected_auto_orders('EURUSD','SELL',s,a) <> 1 THEN
  RAISE EXCEPTION 'Opposing fresh direction must queue'; END IF;
 IF public.queue_selected_auto_orders('USDCHF','WAIT',s,a) <> 0 THEN
  RAISE EXCEPTION 'WAIT must not queue'; END IF;
 IF public.queue_selected_auto_orders('GBPUSD','BUY',jsonb_build_object('validUntil',now()-interval '1 minute'),b) <> 0 THEN
  RAISE EXCEPTION 'Expired signal must not queue'; END IF;
 IF public.queue_selected_auto_orders('BTCUSD','BUY',s,a) <> 0
 OR public.queue_selected_auto_orders('USTECm','BUY',s,a) <> 0
 OR public.queue_selected_auto_orders('USTEC_x100m','BUY',s,a) <> 0 THEN
  RAISE EXCEPTION 'Removed markets must not queue'; END IF;

 SELECT id INTO auto_id FROM public.trade_orders WHERE user_id=a AND market='EURUSD' AND direction='BUY';
 UPDATE public.trade_orders SET created_at=now()-interval '4 minutes' WHERE id=auto_id;
 IF public.queue_selected_auto_orders('EURUSD','BUY',s,a) <> 1 THEN
  RAISE EXCEPTION 'Stuck auto order must not block replacement'; END IF;
 SELECT count(*) INTO n FROM public.trade_orders WHERE id=auto_id AND status='expired';
 IF n <> 1 THEN RAISE EXCEPTION 'Stuck order must expire'; END IF;

 UPDATE public.mt5_links SET auto_trade=false WHERE user_id=a;
 IF public.queue_selected_auto_orders('USDCHF','BUY',s,a) <> 0 THEN
  RAISE EXCEPTION 'Auto OFF must not queue'; END IF;
 INSERT INTO public.trade_orders(user_id,market,direction,lot,signal,source)
 VALUES(a,'XAUUSD','BUY',0.01,s,'manual') RETURNING id INTO manual_id;
 SELECT count(*) INTO n FROM public.claim_mt5_order_v2(ka) WHERE id=manual_id;
 IF n <> 1 THEN RAISE EXCEPTION 'Manual entry must claim while Auto is OFF'; END IF;
 SELECT count(*) INTO n FROM public.trade_orders WHERE user_id=a AND source='auto' AND status='pending';
 IF n <> 0 THEN RAISE EXCEPTION 'Disabled queued auto entries must expire before claim'; END IF;

 UPDATE public.mt5_links SET auto_trade=true,auto_markets=ARRAY['USDCHF'] WHERE user_id=a;
 IF public.queue_selected_auto_orders('USDCHF','BUY',s,a) <> 1 THEN
  RAISE EXCEPTION 'Re-enabled selected pair must queue'; END IF;
 UPDATE public.mt5_links SET auto_markets=ARRAY['GBPUSD'] WHERE user_id=a;
 SELECT count(*) INTO n FROM public.claim_mt5_order_v2(ka);
 IF n <> 0 THEN RAISE EXCEPTION 'Deselected queued pair must not claim'; END IF;

 IF has_function_privilege('anon','public.queue_selected_auto_orders(text,text,jsonb,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.queue_selected_auto_orders(text,text,jsonb,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Ordinary callers must not queue orders for other users'; END IF;
 IF has_function_privilege('anon','public.save_auto_trade_settings(boolean,text[])','EXECUTE') THEN
  RAISE EXCEPTION 'Anonymous callers must not change auto settings'; END IF;
END $$;
ROLLBACK;