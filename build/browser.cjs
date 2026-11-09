'use strict';
// Playwright Chromium for build-time rendering and checks. Looks for a local
// .cache/browsers first (npm run setup:browser with PLAYWRIGHT_BROWSERS_PATH).
const fs = require('node:fs');
const path = require('node:path');
const local = path.resolve(__dirname, '../.cache/browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(local)) process.env.PLAYWRIGHT_BROWSERS_PATH = local;
const {chromium} = require('playwright');
const installed = chromium.executablePath();
const options = {
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || (fs.existsSync(installed) ? installed : undefined),
  // Software WebGL so that headless rendering works on any build machine.
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
};
module.exports = {chromium, options};
