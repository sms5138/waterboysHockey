#!/usr/bin/env node
/* Interactive helper: prompts for a team password, prints the bcrypt hash
   plus a fresh JWT secret, ready to paste into config.json. */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const readline = require('readline');

function ask(question, { silent = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    if (silent) {
      const stdin = process.stdin;
      const onData = (char) => {
        char = char.toString();
        if (['\n', '\r', ''].includes(char)) {
          stdin.removeListener('data', onData);
        } else {
          process.stdout.write('\b \b'.repeat(rl.line.length));
          process.stdout.write('*'.repeat(rl.line.length));
        }
      };
      stdin.on('data', onData);
    }

    rl.question(question, (answer) => {
      rl.close();
      if (silent) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  console.log('Waterboys server — password setup helper\n');

  const pw1 = await ask('Team password: ', { silent: true });
  if (!pw1 || pw1.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }
  const pw2 = await ask('Confirm password: ', { silent: true });
  if (pw1 !== pw2) {
    console.error('Passwords did not match.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(pw1, 12);
  const jwtSecret = crypto.randomBytes(48).toString('hex');

  console.log('\nPaste these into server/config.json:\n');
  console.log(`  "passwordHash": ${JSON.stringify(hash)},`);
  console.log(`  "jwtSecret": ${JSON.stringify(jwtSecret)}`);
  console.log('');
})();
