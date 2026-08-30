#!/usr/bin/env node
// Runs every test/test_*.js in its own process and reports a summary.
// Each suite is standalone (no framework), so a crash in one cannot mask
// another's result.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const suites = fs.readdirSync(dir).filter(f => /^test_.*\.js$/.test(f)).sort();

let failed = 0;
for (const s of suites) {
  process.stdout.write(s.padEnd(24));
  try {
    const out = execFileSync(process.execPath, [path.join(dir, s)],
                             { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(out.trim().split('\n').pop() + '\n');
  } catch (e) {
    failed++;
    const msg = (e.stdout || '') + (e.stderr || '');
    process.stdout.write('FAILED\n' + msg.trim().split('\n').slice(0, 6)
                          .map(l => '    ' + l).join('\n') + '\n');
  }
}

console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
