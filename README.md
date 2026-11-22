# Conduit for desktop

Conduit for Windows and Mac: a desktop client for
[Hermes Agent](https://github.com/NousResearch/hermes-agent), from the makers
of the [Conduit](https://github.com/kaishi00/hermes-conduit) iPhone app. It
talks to the same Hermes dashboard and the same
[Conduit plugin](https://github.com/kaishi00/hermes-conduit-notifier) the
phone does.

**Status: early prototype.** Sign in (or pair with the phone by QR code),
chats and quick ask (with pictures and files: Attach, paste or drop them, and a long
paste goes as a text file, as on the phone), Needs you (approvals and
questions), Bots home and group chats (files too, on a Hermes that keeps room attachments),
several Hermes hosts, the tray and quick ask, and notifications work. It
speaks the iPhone app's thirteen languages, following the computer's or the
one picked in Settings.

## Run it

You need Node 22 and pnpm 10.

    pnpm install
    pnpm dev

Enter your dashboard's address, the one the phone uses, and sign in the way
it asks: user name and password, a session token, or nothing for a dashboard
without its sign-in gate. The sign-in is kept between launches, its secrets
encrypted by the system keychain.

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

## Releases and updates

A `v*` tag matching `package.json`'s version (`v1.0.0` for `1.0.0`) runs
`.github/workflows/release.yml`: it builds the Mac dmg and zip (signed with
the Developer ID and notarized), the Windows installer (unsigned) and the
Linux AppImage onto a draft GitHub release, and the Microsoft Store package
as a workflow artifact to upload to Partner Center, which signs it.
Publishing the draft releases it. A manual run of the workflow from main
with publish checked does the same without a tag (GitHub makes the tag when
the draft is published); mark a beta's release as a pre-release.

Installed copies update themselves from the newest published release
(`src/main/updates.ts`, electron-updater): they check at launch and every
four hours, download in the background and install when Conduit quits, or
at once with Restart to Update in Settings or the tray. A beta gets newer
betas and releases; a release only releases. The Store's copy is updated
by the Store.

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
