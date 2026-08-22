import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Preserve Gregslist provenance; verify redistribution permission before public release.
const SOURCE_URL = 'https://www.google.com/maps/d/embed?mid=13jDZCLk6tlqNfbnUTLSM1hkc228DrpBD'
const OUTPUT_PATH = resolve('src/companies.json')

function decodePageData(html) {
  const assignment = html.match(/\b_pageData\s*=\s*("(?:\\.|[^"\\])*")\s*;/)
  if (!assignment) throw new Error('Gregslist map format changed: _pageData was not found.')

  try {
    return JSON.parse(JSON.parse(assignment[1]))
  } catch (error) {
    throw new Error(`Gregslist map format changed: _pageData is not valid JSON (${error.message}).`)
  }
}

function fieldValue(fields, label) {
  if (!Array.isArray(fields)) return undefined
  for (const entry of fields) {
    if (Array.isArray(entry) && entry[0] === label) return entry[1]?.[0]
    const value = fieldValue(entry, label)
    if (value !== undefined) return value
  }
}

function extractCompanies(pageData) {
  const companies = []

  function visit(node) {
    if (!Array.isArray(node)) return

    const point = node[1]?.[0]?.[0]
    const name = typeof node[0] === 'string' && Array.isArray(point) && point.length === 2
      ? fieldValue(node[5] || [], 'Company Name')
      : undefined
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) throw new Error('Gregslist map format changed: a company marker is missing its name.')

      const [lat, lng] = point
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Gregslist map format changed: a company marker has invalid coordinates.')
      }

      const address = fieldValue(node[5] || [], 'Gregslist City Office Address')
      if (address !== undefined && typeof address !== 'string') {
        throw new Error('Gregslist map format changed: a company address is not text.')
      }

      companies.push(address?.trim()
        ? { name: name.trim(), address: address.trim(), lat, lng }
        : { name: name.trim(), lat, lng })
    }

    node.forEach(visit)
  }

  visit(pageData)
  if (!companies.length) throw new Error('Gregslist map format changed: no company records were found.')
  return companies
}

const response = await fetch(SOURCE_URL)
if (!response.ok) throw new Error(`Gregslist map request failed (${response.status}).`)

const companies = extractCompanies(decodePageData(await response.text()))
await writeFile(OUTPUT_PATH, `${JSON.stringify(companies, null, 2)}\n`)
console.log(`Wrote ${companies.length} Gregslist company records to ${OUTPUT_PATH}`)
