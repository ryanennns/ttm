import assert from 'node:assert/strict'
import { selectBuildingFeatures } from '../src/building-geometry.js'

const polygonSets = (geometry) => [geometry.coordinates]
const getHeight = ({ DERIVED_HEIGHT }) => DERIVED_HEIGHT > 0 ? DERIVED_HEIGHT : 8
const rectangle = (west, south, east, north) => ({
  type: 'Polygon',
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
})
const feature = (OBJECTID, BUILDINGID, DERIVED_HEIGHT, geometry) => ({
  properties: { OBJECTID, BUILDINGID, DERIVED_HEIGHT },
  geometry,
})

const selected = selectBuildingFeatures([
  feature(1, 100, 284, rectangle(0, 0, 0.02, 0.01)),
  feature(2, 100, 296, rectangle(0.005, 0.002, 0.01, 0.008)),
  feature(3, 200, 296, rectangle(0.001, 0.001, 0.019, 0.009)),
  feature(4, 300, 8, rectangle(0.03, 0.03, 0.04, 0.04)),
], {
  getHeight,
  polygonSets,
  metersPerLongitude: 80_700,
  metersPerLatitude: 111_320,
})

assert.deepEqual(selected.map(({ properties }) => properties.OBJECTID), [2, 4])
console.log('building geometry check passed')
