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

export function pointInRing([longitude, latitude], ring) {
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

export function selectBuildingFeatures(features, { getHeight, polygonSets, metersPerLongitude, metersPerLatitude }) {
  const metrics = new Map(
    features.map((feature) => [feature, buildingMetrics(feature, polygonSets, metersPerLongitude, metersPerLatitude)]),
  )
  const tallFeatures = features.filter((feature) => getHeight(feature.properties) >= 180)

  // ponytail: an O(n²) scan is cheap for the tall polygons in one tile; use a spatial index if tile density grows.
  return features.filter((feature) => {
    const featureMetrics = metrics.get(feature)
    const height = getHeight(feature.properties)
    if (!featureMetrics || height < 180) return true

    return !tallFeatures.some((other) => {
      if (other === feature) return false
      const otherMetrics = metrics.get(other)
      if (!otherMetrics || !boundsOverlap(featureMetrics.bounds, otherMetrics.bounds)) return false

      const sameBuilding = feature.properties?.BUILDINGID
        && feature.properties.BUILDINGID === other.properties?.BUILDINGID
      const otherHeight = getHeight(other.properties)

      if (sameBuilding && otherHeight >= height + 5 && otherMetrics.area < featureMetrics.area) return true

      return !sameBuilding
        && otherHeight >= height - 2
        && featureMetrics.area > Math.max(8_000, otherMetrics.area * 4)
        && pointInRing(otherMetrics.center, featureMetrics.ring)
    })
  })
}
