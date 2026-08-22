const METERS_PER_LATITUDE = 111_320

export function validateCompanyRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('Company data must be an array.')

  return records.map((record, index) => {
    if (!record || typeof record !== 'object') throw new TypeError(`Company ${index + 1} must be an object.`)
    if (typeof record.name !== 'string' || !record.name.trim()) throw new TypeError(`Company ${index + 1} needs a name.`)
    if (typeof record.lat !== 'number' || !Number.isFinite(record.lat)) throw new TypeError(`Company ${index + 1} needs a finite latitude.`)
    if (typeof record.lng !== 'number' || !Number.isFinite(record.lng)) throw new TypeError(`Company ${index + 1} needs a finite longitude.`)
    if ('address' in record && typeof record.address !== 'string') throw new TypeError(`Company ${index + 1} address must be a string.`)

    const address = record.address?.trim()
    return address ? { name: record.name.trim(), address, lat: record.lat, lng: record.lng } : {
      name: record.name.trim(),
      lat: record.lat,
      lng: record.lng,
    }
  })
}

export function filterCompaniesToRadius(records, { center, radiusMeters }) {
  const metersPerLongitude = METERS_PER_LATITUDE * Math.cos((center.lat * Math.PI) / 180)
  return records.filter((record) => Math.hypot(
    (record.lng - center.lng) * metersPerLongitude,
    (record.lat - center.lat) * METERS_PER_LATITUDE,
  ) <= radiusMeters)
}

export function fanOutCoordinateCollisions(records, {
  centerLatitude = 43.650085,
  spacingMeters = 18,
} = {}) {
  const counts = new Map()
  const nextIndex = new Map()
  for (const record of records) {
    const key = `${record.lat},${record.lng}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const metersPerLongitude = METERS_PER_LATITUDE * Math.cos((centerLatitude * Math.PI) / 180)
  return records.map((record) => {
    const key = `${record.lat},${record.lng}`
    const count = counts.get(key)
    if (count === 1) return record

    const index = nextIndex.get(key) || 0
    nextIndex.set(key, index + 1)
    const radius = Math.max(spacingMeters, count * 3)
    const angle = (index / count) * Math.PI * 2
    return {
      ...record,
      lat: record.lat + (Math.sin(angle) * radius) / METERS_PER_LATITUDE,
      lng: record.lng + (Math.cos(angle) * radius) / metersPerLongitude,
    }
  })
}

export function selectCompanyRecords(records, options) {
  const validated = validateCompanyRecords(records)
  return fanOutCoordinateCollisions(filterCompaniesToRadius(validated, options), {
    centerLatitude: options.center.lat,
  })
}
