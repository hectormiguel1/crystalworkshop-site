#!/usr/bin/env node
import * as fs from 'node:fs';
import { runLedger } from './ledger.mjs';
process.exitCode = runLedger(process.env, { fs, log: console.log });
