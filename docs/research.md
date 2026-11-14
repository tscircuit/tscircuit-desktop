# Research and decisions

Notes from November 2026 on why tscircuit desktop is built on T3 Code and why it is kept as an overlay. Versions and policies move quickly; re-check the linked sources before relying on a detail.

## Similar interfaces

| Product | What it does | Relevance |
| --- | --- | --- |
| [Claude artifacts](https://ai-design-patterns.pages.dev/teardowns/claude/artifacts) | Conversation on one side, the deliverable in a pane beside it with Preview and Code tabs | The layout this app wants: chat plus a live result |
| [v0](https://www.saasui.design/pattern/chat/v0), [Lovable](https://www.saasui.design/pattern/editor/lovable) | Chat on the left, live app preview on the right, agent steps streaming while the preview waits | Shows the loading states that matter: the model, the code, the render |
| [T3 Code](https://github.com/pingdotgg/t3code) | Open-source Electron app that puts one interface over the coding agents installed on your machine | The base of this app |
| [Flux Copilot](https://www.flux.ai/blog/the-future-of-flux-copilot) | Chat inside a browser EDA tool, next to the schematic | The same layout applied to electronics |
| [chat.tscircuit.com](https://docs.tscircuit.com/advanced/ai-context) | tscircuit's hosted AI chat with live preview | The closest existing tscircuit product; this app differs by using the user's own agent and local files |

## Why T3 Code

An earlier prototype of this app called model APIs directly and rendered with RunFrame in its own window. It worked, but it had to build what T3 Code already has, and it could not use the user's existing agent subscriptions without implementing each provider's sign-in.

| Need | What T3 Code already provides |
| --- | --- |
| Chat with streaming, tool steps, approvals, history | Its chat view and thread store |
| Model selector across providers | Built in; models can change mid-thread |
| Sign in to ChatGPT or Anthropic | It drives the Codex and Claude Code CLIs the user is signed in to, and can start their sign-in from Settings → Providers |
| A real project folder with a shell | Threads run in the project or a git worktree, so the agent can use the `tsci` CLI |
| A pane beside the chat | A right panel with tabs (Diff, Files, Terminal, Browser), each a small typed "surface" |
| Reading the project's files | The file API behind the Files tab, plus a counter that changes after each agent edit |

The last two rows are why the tscircuit part is small: the Circuit tab is one more surface in that panel.

The first version of the preview was a project action that ran `tsci dev` and opened it in T3 Code's in-app browser. It took two lines, but it looked like a web page inside the app: an address bar, RunFrame's own File and View menus, and a dev server to keep running. It was replaced by a dedicated Circuit tab. The tab reads the project's files through T3 Code's file API and passes them to RunFrame in a frame, which takes a file map and an entry path by message and can hide its menus. At first that frame was RunFrame's hosted viewer (`runframe.tscircuit.com/iframe.html`).

Importing RunFrame into T3 Code's web app as a dependency was ruled out. In the earlier prototype it brought undeclared dependencies, a zod version clash, and global styles that broke the host's.

The hosted viewer was then replaced by a copy inside the app, still in a frame: the `tscircuit` package's `dist/browser.min.js` (RunFrame with its eval worker inside), and manifold-3d, both downloaded by `setup` (`viewer.json`). A frame keeps RunFrame's dependencies and styles apart from the host's, which is what importing it could not do. What was found on the way:

- **A frame served by the app shares the app's origin**, unlike `runframe.tscircuit.com`. RunFrame runs the project's code, and the app's origin can start agents and terminals through the local server, so the frame must be kept out of it.
- **The first attempt was a sandbox without `allow-same-origin`**, which makes the frame's origin opaque. It cannot fetch the app's files (so assets are packed into a script and turned into blob URLs), its storage throws (so it gets an in-memory one), and it posts messages with origin `"null"` (so the app checks the sender's window instead).
- **Chromium does not start a module worker from a blob URL in an opaque origin.** The worker's `error` event carries no message. A classic worker starts, and can `import()` the same blob, so the frame swaps one in and replays the messages that arrive before the module is listening. The eval worker has to stay a module because it uses `import.meta`.
- **A worker in an opaque origin is not a secure context**, even when the page that starts it is, so it has no `navigator.gpu`. The PCB viewer draws with WebGPU in a worker and showed "WebGPU is unavailable". This is what ruled the sandbox out for the desktop app.
- **The desktop app now gives the viewer a real origin instead: another host on the app's scheme.** The scheme is registered as standard, so `tscircuit-desktop://viewer` and `tscircuit-desktop://app` are different origins. Checked from inside the frame: the app's page and storage are out of reach, fetching the app's files is refused, and so are requests to the local server, which trusts only the `app` origin. A browser has no second origin to use, so the sandbox remains the fallback there, without the PCB view. `http://viewer.localhost:<port>` would be one way to give a browser a second origin when the app is opened on localhost; it was not tried.
- **The desktop app's content security policy has no `'unsafe-eval'`**, and it is applied to every response of the app's scheme. Responses on the viewer's host get a looser one. The app's policy also had to allow framing that host (`frame-src`).
- **RunFrame's 3D viewer imports manifold-3d from jsDelivr unless `window.MANIFOLD_MODULE` is set.** Given a function, it calls it and uses the result. manifold's loader resolves `manifold.wasm` against `import.meta.url`, which fails on a blob URL, so it is given the bytes and a `locateFile`.
- **RunFrame asks jsDelivr for the newest eval version** unless `window.TSCIRCUIT_LATEST_EVAL_VERSION` or the `evalVersion` prop is set, and **reports to PostHog** unless `window.TSCIRCUIT_TELEMETRY_DISABLED` is set or the page is on localhost.
- **tscircuit's `dist/browser.min.js` could not be driven by a page around it** until 0.0.3179. tscircuit/runframe#6289 added that, behind `window.TSCIRCUIT_USE_RUNFRAME_PROPS_FROM_PARENT`. Before that release the app bundled that pull request's own build, and a separate copy of the eval worker.
- **`dist/browser.min.js` carries the eval worker inside it**, as base64 that it turns into a blob URL, so RunFrame and its worker always match and nothing else has to be packed.
- Still fetched from a CDN by the 3D viewer when a board needs them: three.js fonts, the unicode font index for text, and `occt-import-js` for STEP models. They go through `window.TSCIRCUIT_JSCDN_BASE_URL` if that is set, which would be the way to bundle them too.

## Why an overlay and not a fork

At the time of writing T3 Code's `main` had 10,872 commits, 5,390 of them from the previous 30 days, and a 454 MB history. Two ways to stay current were considered:

| | Regular fork | Pin + overlay + patches (chosen) |
| --- | --- | --- |
| What the repo contains | All of T3 Code plus our commits | Only our files and patches |
| Seeing what we changed | `git diff upstream/main` across 32,000 files | Read `overlay/` and `patches/` |
| Updating | Merge upstream, daily, into a large tree | `npm run bump`: move the pin, re-apply |
| Conflicts | Ordinary merge conflicts | Ordinary merge conflicts, limited to patched files |
| Day-to-day editing | Edit in place | Edit in a generated checkout, then export |
| Renaming the app | A change in ~700 files that conflicts with upstream daily | A list of rules, re-run on every bump |

The overlay costs a slightly indirect edit loop. In return the repo stays small and readable, and it pushes changes toward new files with small hooks, which is also what keeps bumps cheap. The same approach is used by projects that track a fast upstream, such as VSCodium over VS Code and Brave over Chromium.

Details that make it work:

- **Patches are per file and named after the file**, so a failed bump says exactly where to look.
- **Each patch carries a note** above the diff saying why it exists. `export` keeps the note when it rewrites the diff, and CI rejects a patch without one.
- **Patches apply as three-way merges** (`git apply --3way`), so upstream edits elsewhere in a patched file merge automatically and real conflicts appear as normal conflict markers.
- **`setup` will not discard unexported work** in the checkout unless told to.

Bumping was tested from a commit three weeks older than the pin: 3,133 upstream commits, 47 of them touching the one patched file, re-applied with no conflict. A deliberately conflicting upstream edit produced conflict markers, and resolving them and exporting gave a working patch again.

## Signing in

T3 Code does not handle model credentials itself. It runs the agent CLIs on the user's machine and uses whatever account each is signed in to.

- **ChatGPT**: through Codex, which supports signing in with a ChatGPT plan.
- **Anthropic**: through Claude Code. Anthropic's [terms for Claude Code](https://code.claude.com/docs/en/legal-and-compliance) say third-party developers may not offer Claude.ai login in their own products, and separately describe conditions under which a product may run the unmodified Claude Code binary with the user's own sign-in. Anyone distributing a build of this app should read that page and decide how it applies; this note is not legal advice.

## Renaming the app

T3 Code has no single place that holds its name. "T3 Code" appears about 1,200 times across the desktop, web and server code, and the app ID, link scheme and data folder are written out wherever they are used. Three ways to rename it were considered:

| | Patches | Change a few central constants | Find-and-replace rules (chosen) |
| --- | --- | --- | --- |
| Covers | Whatever is patched | Titles and a few dialogs | Every place the text appears |
| On a bump | Conflicts wherever upstream edits a nearby line | Rarely conflicts | Never conflicts; re-run from scratch |
| New text upstream adds | Missed | Missed | Covered |
| Risk | Unmaintainable at this size | Most of the app still says T3 Code | A rule can change something it should not |

The rules live in `renames.json`. To keep that last risk in check: each rule is as narrow as it can be (exact text where possible), each carries its reason, `setup` fails if a rule stops matching, and identifiers that only the app itself or an agent reads are left alone (the `t3-code` name agents use for the app's tools, storage keys, temporary file names).

Beyond the name, the rules give the app its own identity so it can be installed beside T3 Code: app ID, link scheme, profile folder and `~/.tscircuit-desktop` in place of `~/.t3`. Sharing `~/.t3` would have pointed two apps, possibly on different versions, at one database.

The first releases kept the `t3` command and the `T3CODE_` environment variables, on the reasoning that scripts might rely on them. That was wrong for a machine with both apps: the app links its command into `~/.local/bin` on first launch, so it took the name `t3` and T3 Code could no longer install its own, and a `T3CODE_HOME` set for T3 Code would have pointed this app at T3 Code's data. A second round of rules separates everything the two apps would otherwise share on a machine: the command (`tscircuit-desktop`), the variable prefix (`TSCIRCUIT_DESKTOP_`), the project file, the branch prefix, the hidden git refs, the compile cache folder and the background service names. The README's "Beside T3 Code" table lists them.

Two details from that round:

- **The branch prefix is `tscircuit`, without a hyphen.** The code that flattens a temporary branch name (`t3/1a2b3c4d` to `t3-1a2b3c4d`) finds the token after the first `-` or `/`, so a prefix with a hyphen in it would be cut in the wrong place.
- **The command's name in running text is matched by a list of the words that follow it** (`t3 service`, `t3 connect`, "the t3 command"), not every bare `t3`. A looser rule also rewrote `t3` used as data, such as the example under the branch prefix setting.

An install made by a build up to 0.1.3 already has a `t3` link. `apps/desktop/src/tscircuit/legacyT3Command.ts` removes it at startup, only when the link leads to this app's own old launcher, and the command is then installed under the new name.

Things that needed a patch, not a rule, because they change behaviour:

- **Usage analytics default to off.** Upstream's default key reports to T3 Code's analytics service.
- **No import from T3 Code's old profile folders.** Upstream migrates settings from its earlier versions; here that would read another app's data.
- **The logo.** The sidebar and full-page screens show "tscircuit desktop" as text, and the small T3 mark in chat rows is tscircuit's "ts" badge.

Icons are generated from tscircuit's `ts` logo by `branding/make-icons.sh` and stored in `overlay/` at the paths of the T3 Code icons they replace. All three release channels use the same icon.

`branding/icon.svg` is a vector redrawing of the logo at <https://tscircuit.com/tscircuit-logo.png>, pin 1 dot included, and matches it to within a pixel. The first version was copied from `static/logo/ts.svg` in tscircuit/docs, which has no dot; do not use that file as the source until it is corrected.

### Finding what the rules broke

T3 Code's own tests were the check. After the first set of rules, the desktop, web and shared-package suites were run and each failure was read:

- **Real breakage, fixed with more rules:** two places match the link scheme with a pattern (`/^t3code(?:-[a-z]+)?:$/`), so `tscircuit-desktop://` links were not recognised; app links with the name URL-encoded still said T3 Code; the chat did not recognise tool labels carrying the new name.
- **A rule that was wrong, removed:** renaming the Linux program file broke the command-line launcher's tests, and packaging is not being done yet.
- **Tests that still fail, and why that is expected:**
  - `packages/shared`: two search tests and one speech test use "T3 Code" as sample data; one link test lists the old scheme.
  - `apps/web`: tests that check the star prompt and release links point at T3 Code's repository.
  - `apps/desktop`: the test for importing Windows credentials from T3 Code's profile, which is turned off here.
  - `apps/desktop` and `apps/server`, after the command was renamed: tests of the command link and of the standalone installer create files named `t3` by hand (`path.join(home, ".local", "bin", "t3")`) and so no longer find what the code now calls `tscircuit-desktop`. With those names changed in a scratch copy of the desktop test, seven of its eight failures pass; the eighth matches `t3.cmd` in a regular expression of its own. The server's failures of this kind (the installer, the pinned runtime, the Windows service) were read but not re-run this way.

The server suite was started too, but did not finish within 25 minutes in the build sandbox. The six failures in the part that ran all come from the sandbox (no `ssh-keygen`, no IPv6, a git setting that rewrites SSH URLs), not from the renames. The rest of that suite has not been checked.

## Next steps

1. Build installers and try them: the renamed app ID, link scheme and file names have only run in development mode.
2. Point "Report a problem" at this repository.
3. A "new tscircuit project" flow that scaffolds the project and installs the [tscircuit skill](https://github.com/tscircuit/skill) for the agent.
4. Try a full agent turn with a signed-in provider and fix whatever that shows.
5. Write a privacy policy for the app.
