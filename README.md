# tscircuit desktop

A desktop app for designing electronics with [tscircuit](https://github.com/tscircuit/tscircuit) and AI: chat with a coding agent on the left, a live circuit preview (PCB, schematic, 3D) on the right.

![The Circuit tab showing the schematic of led.tsx beside the chat](docs/screenshot.png)

It is built on [T3 Code](https://github.com/pingdotgg/t3code), which provides the chat, the model selector, and sign-in through the agents you already use (Claude Code, Codex and others). This repo renames it, gives it tscircuit's icon, and adds the tscircuit parts.

## This repo is a diff, not a fork

T3 Code lands around 180 commits a day, so this repo does not carry a copy of it. It holds only what tscircuit changes, and rebuilds the full app from that:

```
upstream.json   which T3 Code commit we build on
skill.json      which agent skill to download and bundle into the app
viewer.json     which RunFrame, tscircuit and manifold-3d to bundle as the circuit viewer
renames.json    find-and-replace rules: T3 Code's name, IDs and folders become ours
overlay/        files that exist only here, and icons that replace T3 Code's
patches/        one patch per T3 Code file we change, each with a note saying why
branding/       the icon source and the script that generates the icon files
scripts/        setup, export, bump
.t3code/        the generated app: T3 Code + renames + overlay + patches (not committed)
```

Everything tscircuit-specific is visible in `renames.json`, `overlay/` and `patches/`. Keep patches small: put new code in `overlay/` and use a patch only for the line or two that hooks it in. Small hooks are what keep upstream bumps painless.

### Renames

T3 Code writes its name in about 1,200 places. Carrying those as patches would conflict on every bump, so they are rules in `renames.json` instead: `setup` re-runs them on each new upstream commit, which also covers text upstream adds later. Each rule says why it exists. Patches are then measured against the renamed code, so a rename never shows up as a patch.

`setup` stops if a rule no longer matches anything, because that means upstream reworded the thing the rule was for.

## Run it

You need the Node version T3 Code pins (currently 26.12.1; `setup` tells you if yours differs) and pnpm. On Linux the desktop build also needs `libsecret-1-dev`.

```sh
npm run setup   # fetch T3 Code at the pin, apply overlay + patches, install
npm run dev     # start the desktop app
```

Then, in the app:

1. Add a project folder that contains a tscircuit project.
2. Connect an agent under **Settings → Providers**. T3 Code drives the agent CLIs on your machine, so you sign in to Claude Code or Codex (ChatGPT) the way those tools normally do.
3. Open the right panel and pick **Circuit** (or press `C` in the panel's "+" menu). The tab shows the project's entry file, with a row of views: Source, PCB, Schematic, 3D, System and Assembly.
4. Open any `.tsx` file, from the Files tab or a link in the chat, and the Circuit tab switches to that file. The tab is named after the file it shows.
5. A view the file has nothing for is greyed out. Click it for a short example of what to add, and a button that puts the request in your prompt.

The Circuit tab reads the project's files directly, so there is no dev server to start and no address bar. It re-renders when the agent finishes an edit, when you save a file, and when the window regains focus.

### Install it on a Mac

Download the newest `.dmg` from [Releases](https://github.com/tscircuit/tscircuit-desktop/releases), open it, and drag tscircuit desktop to Applications. Builds are for Apple Silicon.

The builds are not signed with an Apple Developer ID yet. The first time you open a downloaded copy macOS refuses; go to System Settings → Privacy & Security and choose **Open Anyway**.

## Change the app

```sh
npm run setup            # once, or after pulling
# ...edit files inside .t3code/ and try them with `npm run dev`...
npm run export           # save your work back to overlay/ and patches/
```

`export` sorts your changes: files that do not exist upstream go to `overlay/`, so do upstream images you replaced, and each upstream text file you edited gets a patch in `patches/`. A new patch starts with a TODO line; replace it with a sentence on why tscircuit desktop needs the change. Then commit `overlay/` and `patches/`.

`setup` rebuilds `.t3code/` from scratch, so it refuses to run while the checkout holds work you have not exported. Use `npm run setup -- --force` to throw that work away.

Files in `overlay/` live inside T3 Code's tree and follow its lint and format rules. Check them with T3 Code's own tools, for example `npm run t3 -- --dir apps/web vp lint src/tscircuit`.

| Command | What it does |
| --- | --- |
| `npm run setup` | Build `.t3code/` from the pin, overlay and patches, and install dependencies |
| `npm run export` | Save changes in `.t3code/` to `overlay/` and `patches/` |
| `npm run export:check` | Fail if `overlay/` and `patches/` are out of date, or a patch lacks its note |
| `npm run bump` | Move to the newest T3 Code commit and re-apply our changes |
| `npm run dev` | Start the desktop app |
| `npm run build` | Build the desktop app |
| `npm run t3 -- <command>` | Run any command inside `.t3code/`, with T3 Code's `vp` on the PATH |
| `npm run check:app` | Typecheck, lint and test the parts of T3 Code we touch, and run its unused-code check |
| `npm test` | Test the setup, export and bump scripts |

## Follow upstream

```sh
npm run bump             # or: npm run bump -- <commit>
```

`bump` moves `upstream.json` to the tip of T3 Code's `main`, rebuilds, and rewrites the patches against the new code. It prints a link to what upstream changed. Patches are applied as three-way merges, so upstream edits elsewhere in a patched file merge on their own.

When upstream rewrites the same lines a patch touches, `bump` stops and names the file. Open it in `.t3code/`, resolve the conflict markers as you would in any merge, and run `npm run export`.

The **Bump T3 Code** workflow does this daily and opens a pull request when everything still applies and `npm run check:app` passes. It needs the repository setting that lets GitHub Actions create pull requests.

## What tscircuit desktop changes today

| Change | Where |
| --- | --- |
| The app is called tscircuit desktop: window titles, dialogs, error messages, agent prompts | `renames.json` |
| No Beta or Nightly label on the name; only `npm run dev` shows "(Dev)" | `renames.json`, three patches |
| Its own app ID, link scheme (`tscircuit-desktop://`) and data folders (`~/.tscircuit-desktop`), so it can sit beside an installed T3 Code without sharing its data or taking its links | `renames.json` |
| tscircuit's icon for the app, the window and the favicon; "tscircuit desktop" in the sidebar | `overlay/assets/`, `overlay/apps/web/public/`, `branding/`, three patches |
| Usage analytics off by default, and the screens that describe them corrected | Four patches |
| No import of settings from an installed T3 Code's older profile folders | Two patches |
| Download, release and bug-report links point at this repository | `renames.json` |
| The [tscircuit skill](https://github.com/tscircuit/skill) is bundled and installed for agents when the app starts | `skill.json`, `overlay/apps/server/src/tscircuit/`, one patch |
| A **Circuit** tab in the right panel that renders a tscircuit file with RunFrame | `overlay/apps/web/src/tscircuit/` |
| RunFrame, its eval worker and manifold-3d are bundled into the app instead of loaded from the web, and served on a host of their own | `viewer.json`, `scripts/lib/viewer.ts`, `overlay/apps/web/public/tscircuit-viewer/frame.html`, `viewerFrame.ts`, `overlay/apps/desktop/src/tscircuit/`, one patch |
| The Circuit tab's own row of views (Source, PCB, Schematic, 3D, System, Assembly) in place of RunFrame's header; views with nothing to show are greyed out and explain how to fill them | `circuitViews.ts`, `CircuitPanel.tsx`, `CircuitViewHelpDialog.tsx` in that folder |
| Opening a `.tsx` file shows it in the Circuit tab | `circuitSurface.ts` in that folder, called from `patches/apps__web__src__rightPanelStore.ts.patch` |
| Circuit appears in the panel's launcher and "+" menu, and can be reopened after closing | Four patches |

How the Circuit tab works: it reads the project's source files through T3 Code's own file API, picks the file to render (the one you opened, else `mainEntrypoint` from `tscircuit.config.json`, else `index.tsx` and similar), and hands both to RunFrame, which runs in a frame from the app's own files.

The row of views is the app's, not RunFrame's. The app tells RunFrame which view to draw and to hide its own header, and RunFrame reports back what the rendered circuit contains (how many elements of each type) and whether the run failed. From that the app greys out views with nothing in them, moves off an empty view when a file is first opened, and shows RunFrame's error list when a file does not run. Source is drawn by the app from the same file text, with T3 Code's read-only viewer.

### The bundled viewer

`setup` reads `viewer.json` and puts three things into the app, beside `frame.html`:

| | From | Used for |
| --- | --- | --- |
| RunFrame | `"runframe"`: a file pinned by its SHA-256, or `"tscircuit"` for the bundle the tscircuit package ships (`dist/browser.min.js`) | Drawing the views |
| The eval worker | the `tscircuit` package on npm, at the version or tag in `"tscircuit"` (`dist/webworker.min.js`) | Running the project's circuit code |
| manifold-3d | the `manifold-3d` package on npm, at `"manifold"` | The 3D view's geometry |

They are generated, not committed, like the skill. Packages are checked against the hash npm lists for them, and a pinned file against the hash in `viewer.json`; a mismatch stops the build.

**RunFrame is pinned to a pull request's build for now.** The app's row of views needs a RunFrame that a page around it can drive ([tscircuit/runframe#6289](https://github.com/tscircuit/runframe/pull/6289)), and no released tscircuit has one yet. Once one does, set `"runframe": "tscircuit"` and everything comes from the one package. `setup` refuses a RunFrame that is too old for this instead of building an app with a blank tab.

RunFrame runs the project's code, so the frame never shares the app's origin. Otherwise opening a folder you do not trust could run code with the app's session, which can start agents and terminals.

- **In the desktop app** the viewer is served on a host of its own, `tscircuit-desktop://viewer`, which is a different origin from the app's `tscircuit-desktop://app`. It cannot read the app's page, storage or files, and the local server does not accept its requests. That host answers the viewer's three files and nothing else, with a content security policy that allows the eval RunFrame needs and the app's own policy forbids (`circuitViewerHost.ts`).
- **In a browser** (the app served by `tscircuit-desktop` from a terminal) there is only one origin, so the frame is sandboxed without `allow-same-origin` instead, which leaves it with no origin at all. `frame.html` works around what that takes away: the page cannot fetch files, so the worker and manifold-3d are packed as text into `viewer-assets.js` and turned into blob URLs; Chromium will not start a module worker from a blob there, so the worker is started as a classic worker that imports it; and storage throws, so RunFrame gets one in memory. The PCB view does not draw in this mode: see "Known gaps".

To change the icon, edit `branding/app-icon.svg` and run `sh branding/make-icons.sh`, then `npm run export`.

### The bundled skill

`setup` downloads the newest [tscircuit skill](https://github.com/tscircuit/skill) and packs it into the app, so every build carries the skill as it was on the day it was built. It is generated, not committed.

When the app starts it copies the skill to `~/.agents/skills/tscircuit` (read by Codex and most other agents) and `~/.claude/skills/tscircuit` (Claude Code). A folder it installed carries a marker file and is replaced when a newer build brings a newer skill. A folder of that name without the marker is your own copy, for example from `npx skills add tscircuit/skill`, and is left alone.

## Releases and automatic updates

Every push to `main` builds the app and publishes a GitHub release, `v<major>.<minor>.<run>`. Major and minor come from `"version"` in `package.json`; the last number is the release workflow's run number. Changes that only touch documentation do not release.

**The app does not update itself yet.** macOS only lets an app replace itself with a build signed by the same developer, and these builds are not signed with an Apple Developer ID. So releases are built without an update feed, and the app says updates are unavailable instead of downloading something it cannot install. To update, install a newer release.

Turning automatic updates on needs:

1. An Apple Developer ID certificate, and an App Store Connect API key for notarization, added as repository secrets.
2. A change to T3 Code's packaging script, which today only signs when its own passkey sign-in is configured (a provisioning profile and a sign-in domain that tscircuit desktop does not use).
3. Removing `env -u GITHUB_REPOSITORY` from the release workflow's build step. With the repository visible, the build bakes in this repository's releases as its update feed, and the workflow must then also upload the `latest-mac.yml` file the build produces.

## Beside T3 Code

tscircuit desktop is meant to be installed on a machine that also has T3 Code. Each of these is the app's own, so neither app reads, overwrites or removes the other's:

| | tscircuit desktop | T3 Code |
| --- | --- | --- |
| Command | `tscircuit-desktop` | `t3` |
| Data folder | `~/.tscircuit-desktop` | `~/.t3` |
| Environment variables | `TSCIRCUIT_DESKTOP_…` | `T3CODE_…` |
| App ID and link scheme | `com.tscircuit.desktop`, `tscircuit-desktop://` | `com.t3tools.t3code`, `t3code://` |
| Project file | `tscircuit-desktop.json` | `t3.json` |
| Branches it creates | `tscircuit/…` | `t3/…`, `t3code/…` |
| Hidden git refs (checkpoints) | `refs/tscircuit-desktop/…` | `refs/t3/…`, `refs/t3code/…` |
| Compile cache folder | `tscircuit-desktop` | `t3code` |
| Background service | `com.tscircuit.desktop.service`, `tscircuit-desktop.service` | `t3code` |

Builds up to 0.1.3 linked the command as `t3`. The first launch of a newer build removes that link if it is this app's, leaves T3 Code's `t3` alone, and links `tscircuit-desktop` in its place. Checkpoints that 0.1.3 made stay under `refs/t3/` in the project, so threads from that build cannot be rolled back to them.

Still shared, or not yet separate:

- **The agents' own data.** Claude Code, Codex and the others keep their sign-in and history in their own folders, whichever app starts them.
- **Per-branch git settings.** Both apps record a branch's base and pull request under the same `branch.<name>.t3-…` keys in a repository's git config.
- **Linux and Windows package names.** A Linux package would still install a binary named `t3code`. No such package is built yet; this has to change before one is.
- **Remote machines.** Connecting to another computer over SSH installs T3's server there, which uses T3 Code's names on that machine.

## Privacy

This section is where the app's privacy link points. tscircuit desktop has no privacy policy of its own yet, and T3 Code's does not cover this build.

- **Usage analytics are off.** T3 Code sends anonymous usage data to its own analytics service. This build does not, unless you start it with `TSCIRCUIT_DESKTOP_TELEMETRY_ENABLED=true`, in which case the data goes to T3 Code's service, not to tscircuit.
- **Your agent talks to its provider.** Prompts and code go to whichever agent you connect (Claude Code, Codex and others), under that provider's terms.
- **The Circuit tab renders with a copy of RunFrame inside the app.** Nothing is loaded from `runframe.tscircuit.com` or a CDN to draw a circuit, and RunFrame's own usage analytics are turned off. Rendering a circuit can still reach the network: tscircuit looks up parts for the components you use (`jlcsearch.tscircuit.com`, `easyeda.com`), fetches packages your circuit imports, and the 3D view fetches fonts and STEP-import code from a CDN when a board needs them.
- **The list of available models is fetched from T3 Code's GitHub repository.**

This list covers what was checked while building the rename. It is not a full audit of what T3 Code's code contacts.

## Known gaps

- **Some T3 names remain on purpose.** T3 Connect and T3 Chat keep their names because they are T3's own services, agents still see the app's tools under the name `t3-code`, and `npx t3` in the app's text means T3's package on npm. See "Beside T3 Code" for what is separate.
- **No automatic updates, and Apple Silicon only.** Releases are unsigned (see "Releases and automatic updates"). No Intel Mac, Windows or Linux package has been built.
- **The bundled skill is only as new as the build.** It is refreshed when a release is built, not while the app runs.
- **"Report a problem" still files to T3 Code.** The built-in triage agent is written to search and open issues in T3 Code's repository. It needs rewriting for this repository before the app is given to users.
- **The server's own updater still looks at T3 Code's releases.** It applies to servers started with `tscircuit-desktop` from a terminal, not to the desktop app.
- **A few of T3 Code's own tests fail after the renames.** They use the old name as test data or check an upstream link. `npm run check:app` does not run them; see `docs/research.md` for the list.
- **The viewer is the app's copy, not the project's.** A project that installs its own `tscircuit` in `node_modules` is still rendered with the version the app was built with. The viewer adds about 57 MB to the app.
- **The Source view is read-only.** `.tsx` files open in the Circuit tab, where Source shows the text but does not edit it. A link to a specific line still opens T3 Code's editor. `.tsx` files that are not circuits open on Source, with the other views greyed out or an error listed.
- **RunFrame comes from a pull request's build.** See "The bundled viewer".
- **No PCB view when the app is used from a browser.** The PCB view draws with WebGPU in a worker, and a worker in a frame without an origin gets no WebGPU. The desktop app is not affected. Schematic, 3D, System and Assembly work in both.
- **Imports from npm packages are untested.** The viewer gets the project's own source files, not `node_modules`, and resolves packages itself.
- **Large projects are capped.** The tab reads up to 200 source files or 2 MB and says so when it leaves files out. Projects over 40 files refresh on agent edits and window focus only, not on every save.
- **Not yet tried with a real agent turn.** Switching files and live refresh were tested by hand; no signed-in agent was available where this was built.
- **The PCB tab needs WebGPU**, which was unavailable where this was built. The schematic tab rendered there.
- **The bump workflow has not run on GitHub yet.**

Background on these choices is in [docs/research.md](docs/research.md).

## License

The files in this repo are MIT licensed, © tscircuit. T3 Code is MIT licensed, © T3 Tools Inc.; it is downloaded by `npm run setup` and is not redistributed here, apart from the few context lines inside `patches/`. A build you give to others contains T3 Code's code, so it must ship with T3 Code's license and copyright notice.
