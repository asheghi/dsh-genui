import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostRef = process.argv[2]
assert.match(hostRef ?? '', /^dsh-v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/, 'an explicit DSH release tag is required')
const version = hostRef.slice('dsh-v'.length)
const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
const dshPackages = Object.keys(pkg.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-'))
const checkRoot = await mkdtemp(join(tmpdir(), 'dsh-genui-host-api-'))

try {
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.json', 'tsdown.config.ts']) {
    await cp(join(repoRoot, name), join(checkRoot, name))
  }
  await cp(join(repoRoot, 'src'), join(checkRoot, 'src'), { recursive: true })

  // pnpm installs the published packages into an isolated directory, and the
  // imports in the source resolve through that directory's node_modules.
  execFileSync('pnpm', ['add', '--save-dev', '--save-exact', ...dshPackages.map(name => `${name}@${version}`)], { cwd: checkRoot, stdio: 'inherit' })
  for (const name of dshPackages) {
    const installed = JSON.parse(await readFile(join(checkRoot, 'node_modules', name, 'package.json'), 'utf8'))
    assert.equal(installed.version, version, `${name} must use the public types of ${version}`)
  }
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: checkRoot, stdio: 'inherit' })
  execFileSync('pnpm', ['exec', 'tsdown'], { cwd: checkRoot, stdio: 'inherit' })
  console.log(`${hostRef} API typecheck and tsdown build passed`)
} finally {
  await rm(checkRoot, { recursive: true, force: true })
}
