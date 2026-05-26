import { Command } from 'commander';

import { runBindCommand } from './commands/bind.js';
import { runVerifyCommand } from './commands/verify.js';

const program = new Command()
  .name('passportsign')
  .description('Sigstore-adjacent personhood attestations binding GitHub accounts to passport-holding humans.')
  .version('0.0.0');

program
  .command('bind')
  .argument('<github_username>')
  .option('--country', 'disclose issuing country in the attestation')
  .description('Bind a GitHub account to a passport-holding human via zkPassport, logged to Rekor.')
  .action(async (githubUsername: string, opts: { country?: boolean }) => {
    const code = await runBindCommand(githubUsername, { country: opts.country ?? false });
    process.exit(code);
  });

program
  .command('verify')
  .argument('<bundle_path>', 'path to a binding.passportsign.json bundle')
  .option('--no-rekor-refetch', 'skip the Rekor checks (offline structural only)')
  .option('--gist-recheck', 're-fetch the captured gist URL for a liveness signal')
  .description('Verify a passportsign binding bundle.')
  .action(async (bundlePath: string, opts: { rekorRefetch?: boolean; gistRecheck?: boolean }) => {
    const code = await runVerifyCommand(bundlePath, {
      noRekorRefetch: opts.rekorRefetch === false,
      gistRecheck: opts.gistRecheck ?? false,
    });
    process.exit(code);
  });

program
  .command('rebuild')
  .option('--from-checkpoint <hash>', 'resume from a previous log checkpoint')
  .description('Reconstruct the SQLite cache by walking Rekor entries with our predicateType.')
  .action(() => {
    console.error('rebuild: deferred to v1 (public Rekor /retrieve does not index our predicateType)');
    process.exit(2);
  });

program
  .command('init-config')
  .description('Write ~/.passportsign/config.json with default settings.')
  .action(() => {
    console.error('init-config: not implemented yet (Day 7)');
    process.exit(2);
  });

program.parseAsync(process.argv);
