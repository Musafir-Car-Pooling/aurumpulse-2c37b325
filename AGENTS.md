<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Use the allowlisted market registry and shared pure signal engine for every instrument; this preserves the existing gold strategy while keeping quote precision market-specific.
- Persist unattended market scans and deduplicated BUY/SELL alerts through the managed authenticated scan job and its transactional database function; browser polling only reads saved results.
- Keep paid messaging disabled until a sender connection is approved, then implement verified durable WhatsApp callback handling before enabling sends; recipient details must never appear in public market responses.
- Use Nitro's Netlify preset for independent deployments; the existing Lovable wrapper preserves the managed preview target.
- Home-screen installation is manifest-only, with no app-shell service worker; fresh signals must continue to come from the server, not offline caches.
- Reuse the shared BrandLogo asset for the site, favicon and app icons so branding remains consistent.
- Bridge EA revisions consume the existing app order protocol rather than generating local signals; this preserves Auto Trade and manual-entry behavior without changing other users' app settings.
- Signal reads require a signed-in user with an active trial, premium period or admin role, enforced by database policies and server checks; premium is granted only by the database activation function (admin approval or verified crypto payment callback), never by the browser.
- Bridge EA v4 reads live per-market signals from the key-authenticated /api/public/mt5/signal endpoint and mirrors holdDecision() in src/lib/mt5.ts; keeps EA exit logic identical to the tested app rule.
- Keep revised bridge EA source in src/mt5 and test its portable numeric functions directly; deliver a versioned Files copy so source and downloads cannot drift.
- Scope bridge loss-learning statistics by trading account and market/session/direction/entry trend; record observations as suspected causes and use broker candles only to confirm app signals, never to replace them.
