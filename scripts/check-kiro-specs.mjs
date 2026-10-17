import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const SPECS_DIR = path.join(ROOT_DIR, '.kiro', 'specs')

/**
 * Checks all .kiro/specs/* directories to ensure no spec directory sits indefinitely
 * with only a .config.kiro file and no actual spec or status documentation.
 *
 * @param {string} specsDir
 * @returns {{ errors: string[], checkedDirs: string[] }}
 */
export function checkKiroSpecs(specsDir = SPECS_DIR) {
  const errors = []
  const checkedDirs = []

  if (!fs.existsSync(specsDir)) {
    return { errors: [`Specs directory does not exist: ${specsDir}`], checkedDirs: [] }
  }

  const entries = fs.readdirSync(specsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const dirName = entry.name
    const dirPath = path.join(specsDir, dirName)
    checkedDirs.push(dirName)

    const files = fs.readdirSync(dirPath)

    // Filter out .config.kiro and hidden files to check for actual spec/resolution content
    const docFiles = files.filter((f) => f !== '.config.kiro' && !f.startsWith('.'))

    if (files.length === 0) {
      errors.push(`.kiro/specs/${dirName} is empty.`)
    } else if (docFiles.length === 0) {
      errors.push(
        `.kiro/specs/${dirName} contains only .config.kiro and no specification or status document (e.g. requirements.md).`,
      )
    }
  }

  return { errors, checkedDirs }
}

if (process.argv[1] === __filename) {
  const { errors, checkedDirs } = checkKiroSpecs()
  if (errors.length > 0) {
    console.error('❌ Kiro specs check failed:')
    for (const err of errors) {
      console.error(`  - ${err}`)
    }
    process.exit(1)
  }
  console.log(
    `✅ Checked ${checkedDirs.length} .kiro/specs directories. All spec directories contain specification or status documentation.`,
  )
}
