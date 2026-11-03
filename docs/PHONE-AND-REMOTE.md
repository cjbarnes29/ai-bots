# Using the dashboard as an app, and on an Android phone

## What works today (nothing to approve)
The dashboard is an installable app (a PWA). On this Windows PC:
1. Build it once: `npm --prefix web run build`.
2. Start the backend (`npm start`) and the built dashboard (`npm --prefix web run preview`) in two terminals.
3. Open http://127.0.0.1:5173 in Edge or Chrome, then use the install icon in the address bar ("Install AI Workforce").

The app's saved files contain only the page itself. Bot data, approvals and keys are never stored by the browser's cache.

## What does NOT exist yet: reaching it from your phone
The backend deliberately accepts connections from **this PC only**, and the dashboard has **no login**. If it were opened to a network, anyone on
that network could click "Approve" on your bots' outside actions. So phone access is a decision for you, not something switched on automatically.

Recommended design (not built; say "build phone access" to approve it):
1. Use **Tailscale** (free for personal use; you install it on the PC and phone, and it makes a private network only your devices are on).
2. Add an opt-in setting that lets the backend also accept the PC's Tailscale name, and turn it **off** by default.
3. Add a sign-in (a one-time pairing code shown on the PC) so a device on the private network still has to prove it is yours before it can approve anything.
4. On the phone, open the Tailscale address in Chrome and choose "Add to Home screen".

Things you would do yourself: install Tailscale on both devices and sign in to it.
