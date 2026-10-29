# T3 Code on Apple TV

An unofficial weekend project. It is not made by, or supported by, the T3 Code team.

This fork is upstream [T3 Code](https://github.com/pingdotgg/t3code) plus one commit that adds two things:

- **A TV doorbell.** When a thread needs you, finishes, or fails, your Apple TV shows a picture-in-picture card over whatever is playing. The card looks like a thread row in the T3 Code sidebar: thread name, status, project, and branch. It works through HomeKit, so there is nothing to install on the TV.
- **A tvOS app.** A board of your threads, live thread detail, and approvals and answers to agent questions, all from the Siri Remote.

## What you need

- A Mac to run T3 Code. Windows and Linux have not been tried.
- A HomeKit home with a home hub (an Apple TV or HomePod).
- The Apple TV on the same network as the Mac. If they are on different VLANs, the Apple TV must be able to reach the Mac, and Bonjour (mDNS) must cross between them.
- For the tvOS app only: Xcode with the tvOS platform installed, and an Apple developer account.

## 1. Build T3 Code from this fork

Install [`vp`](./README.md#install-vp), then build the desktop app:

```bash
git clone https://github.com/pseudoseed-labs/tVcode.git
cd tVcode
vp i
vp run dist:desktop:dmg
```

The app lands in `release/`. It is unsigned, so the first time you open it, macOS blocks it; allow it in **System Settings → Privacy & Security → Open Anyway**. Packaging prerequisites are in the [development runbook](docs/operations/development.md).

## 2. Set up the doorbell

1. In T3 Code, open **Settings → TV** and turn on **Apple TV doorbell**.
2. On an iPhone in the same Home as your Apple TV, open the Home app, tap **Add Accessory**, and scan the code shown in **Settings → TV**. Home warns that the accessory is uncertified; add it anyway.
3. Press **Test ring**. The card should appear on your TV within a few seconds.

Choose which events ring in the same settings section. Turning the doorbell off stops it and loads nothing. If macOS asks whether T3 Code may accept incoming connections, allow it.

Apple TV shows the card as a still picture. Live video is not supported.

## 3. Install the tvOS app (optional)

Generate the Xcode project with your own bundle ID and team:

```bash
cd apps/tv
T3_TV_BUNDLE_ID=com.yourname.t3code.tv T3_TV_TEAM_ID=YOURTEAMID vp run prebuild
open ios/T3Code.xcworkspace
```

In Xcode, pick your Apple TV (pair it first in **Window → Devices and Simulators**) or an Apple TV simulator, then press Run.

To connect the app:

1. In T3 Code, open **Settings → Sharing & access** and turn on **Network access**.
2. On the same page, create a pairing link.
3. On the TV, enter the Mac's address and the pairing code.

To disconnect later, press Up on the board, choose **Connection**, then **Forget**.

## Add it to your own fork

The whole feature is the one commit on the `feat/apple-tv` branch:

```bash
git remote add tvcode https://github.com/pseudoseed-labs/tVcode.git
git fetch tvcode feat/apple-tv
git cherry-pick tvcode/feat/apple-tv
vp i
```

If `pnpm-lock.yaml` conflicts, keep your version, run `vp i` to regenerate it, then `git cherry-pick --continue`.

## Licenses

The doorbell uses `hap-nodejs` (Apache-2.0), `@resvg/resvg-wasm` (MPL-2.0), `jpeg-js` (BSD-3-Clause), `@noble/ciphers` (MIT), and the DM Sans font (SIL Open Font License 1.1).
