#!/usr/bin/env node
// Produces dist/<name>-<version>.zip containing exactly what Chrome needs.
// Dev-only files (tests, tooling, node_modules) are excluded, so the uploaded
// package matches what the checker validated.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
// The artifact is named from the single naming source, not from package.json,
// so the zip cannot drift from the product name the way the repo once did.
const NAME = require('./naming.js');

// Refuse to package a structure the checker rejects.
execFileSync(process.execPath, [path.join(__dirname, 'check.js')], { stdio: 'inherit' });

const SHIP = ['manifest.json', 'src', 'assets'];
const out = path.join(ROOT, 'dist');
fs.mkdirSync(out, { recursive: true });

const zip = path.join(out, `${NAME.slug}-${manifest.version}.zip`);
fs.rmSync(zip, { force: true });

execFileSync('zip', ['-r', '-q', '-X', zip, ...SHIP,
                     '-x', '*.DS_Store', '-x', '__MACOSX/*'], { cwd: ROOT });

const kb = (fs.statSync(zip).size / 1024).toFixed(0);
console.log(`built ${path.relative(ROOT, zip)} (${kb} KB)`);
