#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const isWindows = process.platform === 'win32'
const result = spawnSync(
  isWindows ? (process.env.ComSpec || 'cmd.exe') : 'pnpm',
  isWindows
    ? ['/d', '/s', '/c', 'pnpm run build']
    : ['run', 'build'],
  {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

if (result.stdout?.length) process.stderr.write(result.stdout)
if (result.stderr?.length) process.stderr.write(result.stderr)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
