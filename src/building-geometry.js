function buildingMetrics(feature, polygonSets, metersPerLongitude, metersPerLatitude) {
  const ring = polygonSets(feature.geometry)[0]?.[0]
  if (!ring?.length) return null

  let area = 0
  let longitude = 0
  let latitude = 0

  for (let index = 0; index < ring.length - 1; index += 1) {
    const [currentLongitude, currentLatitude] = ring[index]
    const [nextLongitude, nextLatitude] = ring[index + 1]
    area += currentLongitude * nextLatitude - nextLongitude * currentLatitude
    longitude += currentLongitude
    latitude += currentLatitude
  }

  const points = ring.length - 1
  return {
    area: Math.abs(area / 2) * metersPerLongitude * metersPerLatitude,
    center: [longitude / points, latitude / points],
    bounds: {
      west: Math.min(...ring.map(([pointLongitude]) => pointLongitude)),
      south: Math.min(...ring.map(([, pointLatitude]) => pointLatitude)),
      east: Math.max(...ring.map(([pointLongitude]) => pointLongitude)),
      north: Math.max(...ring.map(([, pointLatitude]) => pointLatitude)),
    },
    ring,
  }
}

function boundsOverlap(first, second) {
  return first.west <= second.east
    && first.east >= second.west
    && first.south <= second.north
    && first.north >= second.south
}

function pointInRing([longitude, latitude], ring) {
  let inside = false

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLongitude, currentLatitude] = ring[index]
    const [previousLongitude, previousLatitude] = ring[previous]
    const crossesLatitude = (currentLatitude > latitude) !== (previousLatitude > latitude)
    const crossesLongitude = longitude
      < ((previousLongitude - currentLongitude) * (latitude - currentLatitude))
        / (previousLatitude - currentLatitude)
        + currentLongitude

    if (crossesLatitude && crossesLongitude) inside = !inside
  }

  return inside
}

function boundsNearlyEqual(first, second, toleranceDegrees) {
  return Math.abs(first.west - second.west) <= toleranceDegrees
    && Math.abs(first.east - second.east) <= toleranceDegrees
    && Math.abs(first.south - second.south) <= toleranceDegrees
    && Math.abs(first.north - second.north) <= toleranceDegrees
}

// Toronto's massing data often records a building as a cluster of detailed roof-form facets
// (the true, frequently non-rectangular shape) plus one or more coarse, low-vertex envelope
// polygons close to the site's bounding box. Those envelopes are typically recorded at close to
// the same height as their detailed siblings (they're a coarser estimate of the same roofline,
// not a distinct structure), so extruding them too buries the real shape inside a box. A record
// that's meaningfully shorter than a sibling isn't a coarse duplicate of that sibling's roofline —
// it's a genuine lower structure (an annex or podium) and both should render.
const ENVELOPE_AREA_RATIO = 3
const ENVELOPE_HEIGHT_PROTECT_RATIO = 0.6
const DUPLICATE_BOUNDS_TOLERANCE_DEGREES = 1e-7
// Only a simple, low-vertex shape (a near-rectangle) is treated as a coarse duplicate envelope.
// A large polygon with many vertices is tracing real detail, not a bounding box — some complexes
// legitimately decompose only part of their footprint into smaller facets, so a big many-sided
// record can be the sole coverage for the rest and must not be dropped just for being the largest.
const ENVELOPE_MAX_VERTICES = 8

function isRedundantEnvelope(feature, featureMetrics, height, siblings, metrics, getHeight, featureIndex) {
  return siblings.some((sibling) => {
    if (sibling === feature) return false
    const siblingMetrics = metrics.get(sibling)
    if (!siblingMetrics || !boundsOverlap(featureMetrics.bounds, siblingMetrics.bounds)) return false

    const siblingHeight = getHeight(sibling.properties)

    // Two records for the exact same footprint and height: keep only the first-seen one.
    if (
      boundsNearlyEqual(featureMetrics.bounds, siblingMetrics.bounds, DUPLICATE_BOUNDS_TOLERANCE_DEGREES)
      && siblingHeight === height
    ) return featureIndex.get(feature) > featureIndex.get(sibling)

    if (featureMetrics.ring.length - 1 > ENVELOPE_MAX_VERTICES) return false

    // This feature sits well below the sibling's roofline — it's a real lower structure, not a
    // coarse duplicate of the sibling's shape, however large its footprint is.
    if (height < siblingHeight * ENVELOPE_HEIGHT_PROTECT_RATIO) return false

    return featureMetrics.area > siblingMetrics.area * ENVELOPE_AREA_RATIO
      && pointInRing(siblingMetrics.center, featureMetrics.ring)
  })
}

export function selectBuildingFeatures(features, { getHeight, polygonSets, metersPerLongitude, metersPerLatitude }) {
  const metrics = new Map(
    features.map((feature) => [feature, buildingMetrics(feature, polygonSets, metersPerLongitude, metersPerLatitude)]),
  )
  const featureIndex = new Map(features.map((feature, index) => [feature, index]))

  const siblingsByBuildingId = new Map()
  for (const feature of features) {
    const buildingId = feature.properties?.BUILDINGID
    if (!buildingId) continue
    if (!siblingsByBuildingId.has(buildingId)) siblingsByBuildingId.set(buildingId, [])
    siblingsByBuildingId.get(buildingId).push(feature)
  }

  const tallFeatures = features.filter((feature) => getHeight(feature.properties) >= 180)

  // ponytail: an O(n²) scan is cheap for the tall polygons in one tile; use a spatial index if tile density grows.
  return features.filter((feature) => {
    const featureMetrics = metrics.get(feature)
    if (!featureMetrics) return true
    const height = getHeight(feature.properties)

    const siblings = siblingsByBuildingId.get(feature.properties?.BUILDINGID)
    if (siblings && isRedundantEnvelope(feature, featureMetrics, height, siblings, metrics, getHeight, featureIndex)) {
      return false
    }

    if (height < 180) return true

    return !tallFeatures.some((other) => {
      if (other === feature) return false
      const otherMetrics = metrics.get(other)
      if (!otherMetrics || !boundsOverlap(featureMetrics.bounds, otherMetrics.bounds)) return false

      const sameBuilding = feature.properties?.BUILDINGID
        && feature.properties.BUILDINGID === other.properties?.BUILDINGID
      if (sameBuilding) return false // same-building envelopes are already handled above, at any height

      const otherHeight = getHeight(other.properties)

      return otherHeight >= height - 2
        && featureMetrics.area > Math.max(8_000, otherMetrics.area * 4)
        && pointInRing(otherMetrics.center, featureMetrics.ring)
    })
  })
}
