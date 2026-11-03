#!/usr/bin/env node
import * as fs from 'node:fs';
import { runStage } from './stage.mjs';
process.exitCode = await runStage(process.env, { fs, fetchImpl: fetch, log: console.log });
