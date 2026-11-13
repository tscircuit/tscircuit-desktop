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
| A preview pane beside the chat | An in-app browser in the right panel |
| Opening that preview from a command | Project actions accept `previewUrl` and `autoOpenPreview` |

The last two rows are why the tscircuit part is so small. `tsci dev` already serves RunFrame with live reload, so the preview is one project action that runs it and names its URL.

## Why an overlay and not a fork

At the time of writing T3 Code's `main` had 10,872 commits, 5,390 of them from the previous 30 days, and a 454 MB history. Two ways to stay current were considered:

| | Regular fork | Pin + overlay + patches (chosen) |
| --- | --- | --- |
| What the repo contains | All of T3 Code plus our commits | Only our files and patches |
| Seeing what we changed | `git diff upstream/main` across 32,000 files | Read `overlay/` and `patches/` |
| Updating | Merge upstream, daily, into a large tree | `npm run bump`: move the pin, re-apply |
| Conflicts | Ordinary merge conflicts | Ordinary merge conflicts, limited to patched files |
| Day-to-day editing | Edit in place | Edit in a generated checkout, then export |

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

## Next steps

1. Rebrand: name, icons, update feed.
2. Open the preview automatically for tscircuit projects, and give each thread its own preview port.
3. A "new tscircuit project" flow that scaffolds the project and installs the [tscircuit skill](https://github.com/tscircuit/skill) for the agent.
4. Try a full agent turn with a signed-in provider and fix whatever that shows.
