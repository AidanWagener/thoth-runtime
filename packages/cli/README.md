# @thoth-runtime/cli

> The Thoth command-line interface.

## Install

Globally:

```bash
pnpm add -g @thoth-runtime/cli
```

Project-local (typical):

```bash
npx @thoth-runtime/cli init my-thoth
```

## Commands

### `thoth init [dir]`

Scaffold a new Thoth project. Interactive: pick template
(`minimal` / `operator-agent` / `multi-llm-party`), persona structure,
transport, memory backends.

### `thoth start`

Run the bridge in production mode.

### `thoth dev`

Watch mode (tsx). Restarts on file change.

### `thoth doctor`

Validate environment: claude binary on PATH, env vars, sandbox writable,
network reachability of Honcho/Slack/etc.

### `thoth smoke`

Run the full pipeline test against your real claude install.

### `thoth migrate`

Run pending SQLite schema migrations.

### `thoth memory <subcommand>`

`list`, `recall <query>`, `links <id>`, `link <a> <b>`, `unlink <a> <b>`,
`autolink-backfill`, `export`, `delete`.

### `thoth skill <subcommand>`

`list`, `validate <dir>`, `migrate <dir>`, `import <url>`, `export <slug>`,
`ancestors <slug>`, `descendants <slug>`, `rollback <slug> --to <version>`,
`diff <a> <b>`.

### `thoth marketplace <subcommand>`

`publish`, `install <slug>`, `search <q>`, `info <slug>`.

### `thoth mcp <subcommand>`

`install <url>`, `uninstall <name>`, `list`, `box create <name> --include <tools>`,
`doctor`.

### `thoth config <subcommand>`

`show`, `validate`, `edit`.

### `thoth drains <subcommand>`

`test <name>`, `list`, `status`.

## Documentation

[docs.thoth-runtime.dev/cli](https://docs.thoth-runtime.dev/cli)

## License

MIT
