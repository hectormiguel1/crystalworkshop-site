#!/usr/bin/env node
import * as fs from 'node:fs';
import { runPlan } from './plan.mjs';
process.exitCode = await runPlan(process.env, { fs, fetchImpl: fetch, log: console.log });
