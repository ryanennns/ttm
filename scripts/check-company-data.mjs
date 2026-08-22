import assert from 'node:assert/strict'
import companies from '../src/companies.json' with { type: 'json' }
import {
  fanOutCoordinateCollisions,
  filterCompaniesToRadius,
  selectCompanyRecords,
  validateCompanyRecords,
} from '../src/company-data.js'

const center = { lat: 43.650085, lng: -79.38075 }
const radiusMeters = 2_500

assert.ok(companies.length > 0)
assert.equal(validateCompanyRecords(companies).length, companies.length)
assert.ok(companies.every((company) => Object.keys(company).every((key) => ['name', 'address', 'lat', 'lng'].includes(key))))
assert.ok(companies.every(({ name, lat, lng }) => name && Number.isFinite(lat) && Number.isFinite(lng)))
assert.throws(() => validateCompanyRecords([{ name: 'Bad', lat: NaN, lng: center.lng }]), /finite latitude/)
assert.throws(() => validateCompanyRecords([{ name: 'Bad', lat: center.lat, lng: center.lng, address: 3 }]), /address must be a string/)
assert.deepEqual(validateCompanyRecords([{ name: 'No address', lat: center.lat, lng: center.lng }])[0], { name: 'No address', lat: center.lat, lng: center.lng })

const outside = { name: 'Outside', lat: center.lat + 0.1, lng: center.lng }
assert.deepEqual(filterCompaniesToRadius([{ name: 'Inside', ...center }, outside], { center, radiusMeters }).map(({ name }) => name), ['Inside'])

const collision = [
  { name: 'One', ...center },
  { name: 'Two', ...center },
  { name: 'Three', ...center },
]
const fanned = fanOutCoordinateCollisions(collision)
assert.equal(fanned.length, collision.length)
assert.equal(new Set(fanned.map(({ lat, lng }) => `${lat},${lng}`)).size, collision.length)
assert.equal(fanned[0].name, collision[0].name)
assert.equal(new Set(selectCompanyRecords([...collision, outside], { center, radiusMeters }).map(({ lat, lng }) => `${lat},${lng}`)).size, collision.length)

console.log(`company data check passed (${companies.length} records)`)
