import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { checkVercelCron, maxGapMinutes, REQUIRED_CRON_PATHS } from './check-vercel-cron.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Builds a throwaway repo shaped like this one: vercel.json + api/ + ingest.ts. */
function makeRepo({ crons, frontendConfig, lagWarningSeconds = 15 * 60, handler = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-cron-test-'))

  const config = { headers: [] }
  if (crons !== undefined) config.crons = crons
  fs.writeFileSync(path.join(dir, 'vercel.json'), JSON.stringify(config))

  if (handler) {
    fs.mkdirSync(path.join(dir, 'api', 'cron'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'api', 'cron', 'index-tokens.ts'), 'export default () => {}')
  }

  fs.mkdirSync(path.join(dir, 'api', '_lib', 'indexer'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'api', '_lib', 'indexer', 'ingest.ts'),
    `export const LAG_WARNING_SECONDS = ${lagWarningSeconds}\n`,
  )

  if (frontendConfig !== undefined) {
    fs.mkdirSync(path.join(dir, 'frontend'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'frontend', 'vercel.json'), JSON.stringify(frontendConfig))
  }

  return dir
}

const INDEXER_CRON = [{ path: '/api/cron/index-tokens', schedule: '*/5 * * * *' }]

describe('check-vercel-cron', () => {
  it('passes on the real repo configuration', () => {
    const { errors } = checkVercelCron({ rootDir: REPO_ROOT })
    assert.deepEqual(errors, [])
  })

  it('passes when the indexer cron is scheduled every five minutes', () => {
    const dir = makeRepo({ crons: INDEXER_CRON })
    const { errors, crons } = checkVercelCron({ rootDir: dir })
    assert.deepEqual(errors, [])
    assert.equal(crons.length, 1)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('fails when vercel.json has no crons array at all (issue #1090)', () => {
    const dir = makeRepo({})
    const { errors } = checkVercelCron({ rootDir: dir })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /no non-empty "crons" array/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('fails when the crons array exists but omits the indexer path', () => {
    const dir = makeRepo({ crons: [{ path: '/api/health/ipfs', schedule: '0 0 * * *' }] })
    const { errors } = checkVercelCron({ rootDir: dir })
    assert.ok(errors.some((e) => e.includes(REQUIRED_CRON_PATHS[0])))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('fails when a cron path has no handler on disk', () => {
    const dir = makeRepo({ crons: INDEXER_CRON, handler: false })
    const { errors } = checkVercelCron({ rootDir: dir })
    assert.ok(errors.some((e) => /no handler exists there/.test(e)))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('fails when the cadence is coarser than the lag warning threshold', () => {
    // Hobby's daily-only cron against the 15-minute warning threshold: the
    // health endpoint would report a warning even when ingest is healthy.
    const dir = makeRepo({ crons: [{ path: '/api/cron/index-tokens', schedule: '0 0 * * *' }] })
    const { errors } = checkVercelCron({ rootDir: dir })
    assert.ok(errors.some((e) => /exceeds LAG_WARNING_SECONDS/.test(e)))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a coarse cadence once the thresholds are relaxed to match', () => {
    const dir = makeRepo({
      crons: [{ path: '/api/cron/index-tokens', schedule: '*/30 * * * *' }],
      lagWarningSeconds: 45 * 60,
    })
    const { errors } = checkVercelCron({ rootDir: dir })
    assert.deepEqual(errors, [])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a schedule that is not a five-field cron expression', () => {
    const dir = makeRepo({ crons: [{ path: '/api/cron/index-tokens', schedule: '@hourly' }] })
    const { errors } = checkVercelCron({ rootDir: dir })
    assert.ok(errors.some((e) => /five-field cron/.test(e)))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects crons declared in frontend/vercel.json, which ships no api/ functions', () => {
    const dir = makeRepo({ crons: INDEXER_CRON, frontendConfig: { crons: INDEXER_CRON } })
    const { errors } = checkVercelCron({ rootDir: dir })
    assert.ok(errors.some((e) => /frontend\/vercel\.json defines "crons"/.test(e)))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('ignores a frontend/vercel.json that only sets headers', () => {
    const dir = makeRepo({ crons: INDEXER_CRON, frontendConfig: { headers: [] } })
    const { errors } = checkVercelCron({ rootDir: dir })
    assert.deepEqual(errors, [])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('maxGapMinutes', () => {
  it('measures step schedules by their worst-case gap, including the wrap-around', () => {
    assert.equal(maxGapMinutes('*/5 * * * *'), 5)
    assert.equal(maxGapMinutes('* * * * *'), 1)
    // Fires at :00 and :45 — the 45-minute gap is what matters, not the step.
    assert.equal(maxGapMinutes('*/45 * * * *'), 45)
    // Fires at :00,:07,…,:56, then waits 4 minutes for the next hour.
    assert.equal(maxGapMinutes('*/7 * * * *'), 7)
  })

  it('measures explicit minute lists across the hour boundary', () => {
    assert.equal(maxGapMinutes('0,30 * * * *'), 30)
    assert.equal(maxGapMinutes('0,5,10 * * * *'), 50)
    assert.equal(maxGapMinutes('17 * * * *'), 60)
  })

  it('measures hourly and daily cadences', () => {
    assert.equal(maxGapMinutes('0 0 * * *'), 24 * 60)
    assert.equal(maxGapMinutes('0 */6 * * *'), 6 * 60)
    assert.equal(maxGapMinutes('0 9-17 * * *'), 16 * 60)
  })

  it('returns null rather than guessing at expressions it cannot reason about', () => {
    assert.equal(maxGapMinutes('@daily'), null)
    assert.equal(maxGapMinutes('0 0 * * 1'), null)
    assert.equal(maxGapMinutes('0 0 1 * *'), null)
    assert.equal(maxGapMinutes('*/x * * * *'), null)
    assert.equal(maxGapMinutes(undefined), null)
  })
})
