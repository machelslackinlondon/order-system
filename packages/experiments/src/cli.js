#!/usr/bin/env node

import { runExperimentCli } from './index.js';

process.exitCode = await runExperimentCli(process.argv.slice(2));
