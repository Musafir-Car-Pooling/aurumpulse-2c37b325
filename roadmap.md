# Market alerts

## Bridge loss learning revision
- [x] Replace daily-loss stop and consecutive-loss cooldown with evidence-based entry adjustments and per-loss mistake logging.
- [x] Deliver bridge v15 and execute its portable loss-learning and exit rules; app MT5 tests pass.
- [ ] Compile bridge v15 and verify mistake files plus adaptive re-entry on MT5 demo — MetaEditor and a broker terminal are unavailable here.

## Netlify launch
- [x] Configure Netlify deployment and document required external settings.
- [x] Add home-screen installation and browser install prompt (no offline caching).
- [x] Add a suitable logo, matching favicon and app icons.
- [x] Verify installation controls, metadata and mobile/desktop rendering; native install event simulated, four tests pass.
- [ ] Verify Netlify production install and full application flows — live URL returns 404; redeployment and external-hosting backend decision required because managed privileged credentials are not exportable.

- [x] Add BTCUSD, EURUSD, GBPUSD, and USDJPY without changing the gold strategy.
- [x] Add saved scanning, current-market timestamps, and stale-data protection; authenticated scanner verified in preview.
- [x] Add BUY/SELL-only app alerts and duplicate suppression.
- [x] Enable Lovable Cloud, persist scans and alerts, and create the minute-by-minute scanning schedule.
- [x] Test market selection and rule coverage; verify live BTC analysis and closed-market handling on desktop and phone.
- [x] Activate unattended production scanning — app published at aurumpulse.lovable.app; minute scanner now runs against the live app.
- [ ] Connect WhatsApp and implement/test sending, signed callbacks, delivery tracking and recovery — connection declined; approved sender/template and publishing required.- [x] 3-day free trial, Daily/Weekly/Monthly packages, signals locked after trial, manual payment review and crypto checkout.
- [ ] Crypto payments live — waiting for the user's NOWPayments API key and IPN secret.
- [x] Binance address added; admin can add/update manual methods.
- [x] Admin access for pp@gmail.com — account created on the server, email confirmed, admin role granted.
- [x] Side menu and a sign-in option stay available when Premium mode is off.
- [x] Deliver bridge EA v3 with fixed 0.01 lot, no SL/TP, and USD 1 profit exit; numeric rules tested.
- [ ] Compile bridge EA v3 and verify an entry/profit-close cycle on MT5 demo — MetaEditor and a broker terminal are unavailable here.

## Selectable auto trading
- [x] Save per-user selected markets and enforce them for automatic entries.
- [x] Add pair selection on home and Connect MT5; preserve manual entries.
- [x] Keep confirmed XAUUSD, EURUSD, GBPUSD, USDJPY, USDCHF; remove BTCUSD/USTEC from active feeds and bridge.
- [x] Test saved selection and automatic queue; deliver Bridge v18 with synchronized app download.
- [ ] Compile Bridge v18 and verify real selected-pair execution on MT5 demo — MetaEditor/broker terminal unavailable and connected user's MT5 is offline; all five markets are closed on Saturday.
