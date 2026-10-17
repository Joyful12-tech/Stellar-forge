import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { checkKiroSpecs } from './check-kiro-specs.mjs'

describe('check-kiro-specs', () => {
  it('passes when spec directory has requirements.md and .config.kiro', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-test-'))
    const specDir = path.join(tmpDir, 'sample-spec')
    fs.mkdirSync(specDir, { recursive: true })
    fs.writeFileSync(path.join(specDir, '.config.kiro'), '{}')
    fs.writeFileSync(path.join(specDir, 'requirements.md'), '# Spec')

    const { errors, checkedDirs } = checkKiroSpecs(tmpDir)
    assert.deepEqual(errors, [])
    assert.deepEqual(checkedDirs, ['sample-spec'])

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('fails when a spec directory contains only .config.kiro', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-test-'))
    const specDir = path.join(tmpDir, 'stub-spec')
    fs.mkdirSync(specDir, { recursive: true })
    fs.writeFileSync(path.join(specDir, '.config.kiro'), '{}')

    const { errors, checkedDirs } = checkKiroSpecs(tmpDir)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /contains only \.config\.kiro/)
    assert.deepEqual(checkedDirs, ['stub-spec'])

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('validates the checked-in .kiro/specs directory in repository', () => {
    const { errors, checkedDirs } = checkKiroSpecs()
    assert.deepEqual(errors, [])
    assert.ok(checkedDirs.length >= 11, 'Should check all spec directories')
  })
})
