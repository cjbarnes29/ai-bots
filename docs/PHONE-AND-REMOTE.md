# Using the platform from your Windows PC and your Android phone

The Windows PC is the server. Your bots, chats, tasks, schedules and settings all live in one database on the PC. The phone is just another
screen on the same data, so everything stays in step automatically (screens re-read the server every 15 seconds and when you return to them;
the Approvals badge every 5 seconds).

## How it is kept safe
- The app still listens on **this PC only** (127.0.0.1). Nothing is opened to your network or the internet.
- **Tailscale Serve** (a free feature of Tailscale, running on the PC) is the only bridge. It makes a private HTTPS address that **only your own
  devices signed in to your Tailscale account** can reach. Do **not** use "Tailscale Funnel" (that is public).
- Phone access is **off** until you list the PC's Tailscale name in `REMOTE_HOSTS` (only `*.ts.net` names are accepted).
- A phone must be **paired**: on the PC you press "Pair a phone" and get a one-time code (10 characters, valid 5 minutes, destroyed after 5 wrong
  guesses). The phone swaps it for a long secret kept in an HttpOnly, Secure, SameSite=Strict cookie. The PC stores only a hash.
- You can **revoke** a phone on the PC at any moment; it is locked out immediately. A phone unused for 90 days stops working.
- Everything a phone changes is written to the permanent security log with the phone's name.
- A phone **can**: chat, give tasks, edit bots, schedules and triggers, and **approve or deny** actions (the same one-click approval as on the PC).
- A phone **cannot**: save or remove secrets/API keys, change AI providers, models or usage limits, change a bot's outside-access permissions or
  teammate list, start the Gmail sign-in, create or revoke pairings, or switch a paused system back on (it **can** pause).
- If a proxy ever hides a remote caller behind a local name, the request is refused rather than trusted.

## One-time setup (you do these steps; about 15 minutes)
1. **Tailscale account** (free): sign up at tailscale.com.
2. **Install Tailscale on the PC** (Windows) and on the **Android phone** (Play Store), and sign in with the same account on both.
3. In the Tailscale admin page (login.tailscale.com) open **DNS** and switch on **HTTPS Certificates** (needed so the phone can install the app).
4. On the PC, find its name: open the Tailscale window and note the machine name such as `my-pc.tail1234.ts.net` (the full name ends in `.ts.net`).
5. In this project folder, create or edit the file `.env` and add the line:
   `REMOTE_HOSTS=my-pc.tail1234.ts.net` (use your real name).
6. Build the dashboard once: `npm --prefix web run build`.
7. Start the app: `npm start`. (It now also serves the dashboard on http://127.0.0.1:3000.)
8. In a second terminal on the PC run: `tailscale serve --bg 3000` (if your Tailscale version words this differently, its `tailscale serve --help` shows the
   current form: it must publish https://my-pc.tail1234.ts.net to http://127.0.0.1:3000 — privately, not Funnel).
9. On the PC open http://127.0.0.1:3000/settings → **Devices** → **Pair a phone**.
10. On the phone open the address it shows (it already contains the code), check the name, and press **Pair**.
11. On the phone in Chrome choose **⋮ → Install app** (or **Add to Home screen**). It opens like a normal app.

To use the app from the PC you can keep using http://127.0.0.1:5173 (development) or http://127.0.0.1:3000 (built).
Your PC must be on, signed in to Tailscale and running the app for the phone to connect.

## Not built (and why)
- **Push notifications** when an approval is waiting: the Approvals badge updates while the app is open, but the phone does not buzz when closed.
  (Reliable push needs Google/Apple push services, which are external accounts.)
- **Real-device test**: all of this is tested with a pretend Tailscale (an HTTPS proxy on the PC that adds the same headers) and a desktop browser in
  phone mode. It has not been tried with real Tailscale or a real Android phone. If something differs (for example the exact proxy headers), the app
  fails closed (refuses) rather than opening up.
