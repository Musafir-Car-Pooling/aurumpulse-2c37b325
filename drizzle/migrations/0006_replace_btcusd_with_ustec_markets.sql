ALTER TABLE public.market_scans DROP CONSTRAINT market_scans_market_check;
ALTER TABLE public.market_scans ADD CONSTRAINT market_scans_market_check CHECK (market = ANY (ARRAY['XAUUSD','USTECm','USTEC_x100m','EURUSD','GBPUSD','USDJPY']));
ALTER TABLE public.signal_alerts DROP CONSTRAINT signal_alerts_market_check;
ALTER TABLE public.signal_alerts ADD CONSTRAINT signal_alerts_market_check CHECK (market = ANY (ARRAY['XAUUSD','USTECm','USTEC_x100m','EURUSD','GBPUSD','USDJPY']));