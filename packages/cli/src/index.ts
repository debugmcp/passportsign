#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command()
  .name('passportsign')
  .description('Sigstore-adjacent personhood attestations binding GitHub accounts to passport-holding humans.')
  .version('0.0.0');

program
  .command('bind')
  .argument('<github_username>')
  .option('--country', 'disclose issuing country in the attestation')
  .description('Bind a GitHub account to a passport-holding human via zkPassport, logged to Rekor.')
  .action(() => {
    console.error('bind: not implemented yet');
    process.exit(2);
  });

program
  .command('verify')
  .argument('<bundle_path>')
  .option('--gist-recheck', 're-fetch the gist for a liveness check')
  .option('--rekor-refetch', 're-fetch the Rekor entry and current root')
  .description('Verify a binding bundle offline.')
  .action(() => {
    console.error('verify: not implemented yet');
    process.exit(2);
  });

program
  .command('rebuild')
  .option('--from-checkpoint <hash>', 'resume from a previous log checkpoint')
  .description('Reconstruct the SQLite cache by walking Rekor entries with our predicateType.')
  .action(() => {
    console.error('rebuild: not implemented yet');
    process.exit(2);
  });

program
  .command('init-config')
  .description('Write ~/.passportsign/config.json with default settings.')
  .action(() => {
    console.error('init-config: not implemented yet');
    process.exit(2);
  });

program.parseAsync(process.argv);
