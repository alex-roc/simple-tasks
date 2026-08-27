# Contributing to Simple Tasks

Thanks for taking the time. Bug reports are as welcome as code, and a report
with the markdown that triggered it is worth more than a patch that guesses.

## Reporting a bug

Open an issue with:

- what you did and what happened instead;
- **the task lines involved**, copied verbatim — indentation, list markers and
  emoji included. Most bugs here are about a shape of markdown, and the shape is
  the information;
- your Obsidian version, your platform (desktop or mobile), and whether Periodic
  Notes or the core Daily notes plugin is what creates your notes.

If the bug involves losing or mangling text in a note, say so plainly in the
title. Those come first.

## Setting up

Node 22+ and [pnpm](https://pnpm.io) (via corepack). npm and yarn are not used
here — the lockfile is pnpm's.

```bash
pnpm install
pnpm dev      # esbuild in watch mode; writes main.js at the repo root
```

To try it in Obsidian, symlink the repo into a **test** vault rather than your
real one, and let [Hot Reload](https://github.com/pjeby/hot-reload) pick up each
build:

```bash
ln -sfn "$PWD" ~/my-test-vault/.obsidian/plugins/simple-tasks
```

## Before opening a pull request

```bash
pnpm test     # unit tests of the pure domain, under node --test
pnpm verify   # the real parser over a whole vault, no Obsidian needed
pnpm lint     # eslint-plugin-obsidianmd, the same ruleset the directory scans
pnpm build    # type check plus a production bundle
```

All four have to pass. `pnpm lint` must be **clean of warnings**, not just of
errors: the community directory publishes those warnings on the plugin's
scorecard.

## What the code expects of a change

- **The domain stays pure.** Anything under `src/domain/` must not import a
  runtime value from `obsidian`, touch `app`, the DOM or the vault. That is what
  keeps it testable with `node --test` and what makes `pnpm verify` possible.
- **Hierarchy comes from the index, never from counting indentation.**
  `ListItemCache.parent` is the only source of truth for what is nested in what.
- **Writes to a note go through `vault.process()`**, or through the Editor API
  when the file is open. A change that moves lines around must be tried against
  a git-tracked vault, with the actual diff inspected — "it did not throw" is not
  evidence that no subtask was lost.
- **Only Obsidian CSS variables** in `styles.css`; no literal colors, ever, and
  check both light and dark themes.
- **User-visible strings live in `src/i18n/`**, in both `en.ts` and `es.ts`, in
  sentence case.

`AGENTS.md` is the long version of all of this, and `dev-docs/` records why
things are the way they are. Reading the file you are about to change is usually
faster than asking.

## Commits

Conventional prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `style:`), a
subject that says what changed, and a body that says **why** when the why is not
obvious. Present tense, no trailing period.

## License

By contributing you agree that your work is licensed under this repository's
[MIT license](LICENSE).
