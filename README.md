# Conduit for desktop

Conduit for Windows and Mac: a desktop client for
[Hermes Agent](https://github.com/NousResearch/hermes-agent), from the makers
of the [Conduit](https://github.com/kaishi00/hermes-conduit) iPhone app. It
talks to the same Hermes dashboard and the same
[Conduit plugin](https://github.com/kaishi00/hermes-conduit-notifier) the
phone does.

![Conduit for desktop: the Chats list beside a chat with Hermes](docs/media/chats.webp)

Your chats, bots, group chats and Needs you (approvals and questions), in a
window of their own. Send pictures and files (attach, paste or drop them),
pop a chat out into its own window, ask from anywhere with Quick Ask, call
your bot with the phone's voice modes, and keep several Hermes hosts
side by side. Close the window and Conduit stays in the tray (the menu bar
on the Mac), so approvals and finished replies still reach you as
notifications. It speaks the iPhone app's thirteen languages.

It works on its own: you don't need the iPhone app. Your chats live in your
Hermes, so they're the same on the phone, the desktop and Hermes' own
dashboard.

## Download

| | |
|---|---|
| **Mac** (Apple silicon and Intel, macOS 12 or later) | [Conduit-mac.dmg](https://github.com/kaishi00/hermes-conduit-desktop/releases/latest/download/Conduit-mac.dmg) |
| **Windows** (10 and 11, x64 and Arm) | [Conduit-Setup.exe](https://github.com/kaishi00/hermes-conduit-desktop/releases/latest/download/Conduit-Setup.exe) |
| **Linux** (x64) | [Conduit-linux-x86_64.AppImage](https://github.com/kaishi00/hermes-conduit-desktop/releases/latest/download/Conduit-linux-x86_64.AppImage) |

Every release and what changed in it are on the
[Releases page](https://github.com/kaishi00/hermes-conduit-desktop/releases).

## Install

**Mac.** Open the dmg and drag Conduit into Applications. The app is signed
and notarized by Apple, so it opens without a warning. The first time you
dictate or send a voice message, macOS asks for the microphone.

**Windows.** Run Conduit-Setup.exe. It installs for your account only, with
no administrator prompt, and opens Conduit when it's done. The installer
isn't code-signed yet, so Windows may say "Windows protected your PC": click
**More info**, then **Run anyway**. With Smart App Control turned on, Windows
may block it outright; a signed copy from the Microsoft Store is on its way.

**Linux.** Make the AppImage executable (`chmod +x Conduit-linux-x86_64.AppImage`)
and run it.

## Connect to your Hermes

![Bots in Conduit for desktop](docs/media/bots.webp)

Conduit talks to the web dashboard that comes with
[Hermes Agent](https://github.com/NousResearch/hermes-agent)
(`hermes dashboard`, port 9119 by default). There's no Conduit server to
install.

1. Enter the dashboard's address, the same one the iPhone app uses: a
   Tailscale name, an address on your Wi-Fi such as `192.168.1.20:9119`, or
   your own domain.
2. Sign in the way your dashboard asks: user name and password, a session
   token, or nothing for a dashboard without its sign-in gate. For a
   dashboard behind Cloudflare Access or another proxy, enter its service
   token or headers under **Behind Cloudflare Access or another proxy?**
3. Already signed in on the iPhone? Choose **Pair with your iPhone** instead,
   then in Conduit on the phone open Settings > Connection > Pair a Computer
   and scan the code.

Conduit remembers the sign-in, with its password or token encrypted by the
Mac's Keychain or Windows' own encryption. Add more Hermes hosts with
**Add another Hermes…** in Settings > Connection.

The free [Conduit plugin](https://github.com/kaishi00/hermes-conduit-notifier)
on your Hermes host adds notifications, live voice calls, Pulse and the rest
of Conduit's features. Install it with
`hermes plugins install kaishi00/hermes-conduit-notifier --enable`, then
restart Hermes. The iPhone app's
[Connecting](https://github.com/kaishi00/hermes-conduit#connecting) guide
covers Tailscale, Docker and setting up a dashboard by hand.

## Updates

Conduit updates itself. It checks for a new version when it opens and every
few hours, downloads it in the background and installs it the next time you
quit. To install it right away, choose **Restart to Update** in Settings >
App > Updates or in the tray menu. Settings > App > Updates also shows your
version and has **Check for Updates**; turn off **Install updates
automatically** to download each update yourself.

The Microsoft Store's copy is updated by the Store.

## Run it from source

You need Node 22 and pnpm 10.

    pnpm install
    pnpm dev

## Checks

    pnpm typecheck
    pnpm test
    pnpm build

`test/live` runs a real turn against a dashboard and is skipped unless you
point it at one:

    CONDUIT_LIVE_URL=http://127.0.0.1:9119 pnpm test test/live

(add `CONDUIT_LIVE_USER` and `CONDUIT_LIVE_PASSWORD`, or `CONDUIT_LIVE_TOKEN`,
for a dashboard that asks for a sign-in).

## Packages

    pnpm package

builds an installer for the platform you're on, in `release/`. CI builds the
Windows installer and the Mac dmg, unsigned, for every pull request.

The screenshots in `docs/media/` come from a demo Hermes with a scripted
model (the iPhone app's `scripts/app-store/start-demo-hermes.sh`), not a real
account.

## Releasing

A `v*` tag matching `package.json`'s version (`v1.0.0` for `1.0.0`) runs
`.github/workflows/release.yml`: it builds the Mac dmg and zip (signed with
the Developer ID and notarized), the Windows installer (unsigned) and the
Linux AppImage onto a draft GitHub release, and the Microsoft Store package
as a workflow artifact to upload to Partner Center, which signs it.
Publishing the draft releases it. A manual run of the workflow from main
with publish checked does the same without a tag (GitHub makes the tag when
the draft is published); mark a beta's release as a pre-release.

Installed copies update from the newest published release
(`src/main/updates.ts`, electron-updater). A beta gets newer betas and
releases; a release only releases.

## How it's put together

- `src/main`: the Electron main process. It owns the connection to Hermes
  (`connection.ts`), signs in (`auth.ts`) and keeps the sign-in
  (`store.ts`). The window never sees a password, cookie or token.
- `src/preload`: the small API the window gets (`window.conduit`).
- `src/renderer`: the window, in React. `state/` turns Hermes' events into
  the transcript and the chat list; `components/` draws them.
- `src/shared/i18n.ts` and `strings.json`: every word on screen, in each
  language. The English text is the key. `scripts/import-ios-strings.mjs`
  copies the iPhone app's translations in wherever both apps say the same
  thing, and `test/strings.test.ts` fails on a key missing a language.
- `src/vendor/hermes-shared`: Hermes' own gateway client and wire types,
  copied unchanged under its MIT license (see `UPSTREAM.md` there).

As in the phone app, logic that both apps need goes in the Conduit plugin,
and this app draws what it sends.

## License

MIT. The Bot's Screen viewer bundles [noVNC](https://github.com/novnc/noVNC)'s RFB client, under the MPL-2.0.
