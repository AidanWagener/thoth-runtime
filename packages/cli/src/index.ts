#!/usr/bin/env node
// @thoth-runtime/cli — entry point.

import { Command } from 'commander';
import kleur from 'kleur';
import { start } from './start';

const program = new Command();

program
  .name('thoth')
  .description('Thoth — the lifelong-learning agent runtime')
  .version('0.5.0');

program
  .command('start')
  .description('Run the bridge in production mode')
  .action(async () => {
    try {
      await start();
    } catch (err) {
      console.error(kleur.red('fatal:'), err);
      process.exit(1);
    }
  });

program
  .command('dev')
  .description('Run in watch mode (alias for `tsx watch src/index.ts`)')
  .action(() => {
    console.log(kleur.yellow('dev mode: use `tsx watch path/to/start.ts` directly, or run `pnpm dev` in your project.'));
  });

program
  .command('doctor')
  .description('Validate environment + dependencies')
  .action(() => {
    console.log(kleur.cyan('thoth doctor'));
    console.log('  - Node version: ' + process.version);
    console.log('  - Platform: ' + process.platform);
    console.log(kleur.yellow('  - Full diagnostic suite ships at v0.5.1'));
  });

program
  .command('init [dir]')
  .description('Scaffold a new Thoth project')
  .action((_dir: string | undefined) => {
    console.log(kleur.yellow('Pre-launch state. CLI scaffolding lands at v0.5.0 release (2026-07-22).'));
    console.log(kleur.dim('Track progress at https://github.com/thoth-runtime/thoth'));
  });

program.parse();
