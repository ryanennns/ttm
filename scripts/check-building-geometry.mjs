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
  // A supertall (>=180m) with a coarse, slightly-shorter envelope duplicate alongside the real,
  // narrower footprint — the original case selectBuildingFeatures was built for.
  feature(1, 100, 284, rectangle(0, 0, 0.02, 0.01)),
  feature(2, 100, 296, rectangle(0.005, 0.002, 0.01, 0.008)),
  // A different, unrelated building whose coarse envelope happens to overlap that same tower.
  feature(3, 200, 296, rectangle(0.001, 0.001, 0.019, 0.009)),
  // An unrelated short building, well under any height threshold.
  feature(4, 300, 8, rectangle(0.03, 0.03, 0.04, 0.04)),

  // A mid-rise (well under 180m) with the same coarse-envelope-at-roughly-the-same-height problem —
  // this is the "+"-shaped-building case: a big rectangle recorded at ~56m sitting right on top of
  // the real ~54m detail footprint should be dropped in favor of the detail.
  feature(5, 500, 56, rectangle(1, 1, 1.02, 1.01)),
  feature(6, 500, 54, rectangle(1.005, 1.002, 1.01, 1.008)),

  // A genuine podium (20m) with a much taller, narrower tower (120m) on the same BUILDINGID — the
  // height gap is large, so the podium is a real lower structure and both records should survive.
  feature(7, 600, 20, rectangle(2, 2, 2.02, 2.01)),
  feature(8, 600, 120, rectangle(2.005, 2.002, 2.01, 2.008)),

  // Two records for the exact same footprint and height (a genuine duplicate row in the source
  // data) — only the first-seen one should survive.
  feature(9, 700, 55.7, rectangle(3, 3, 3.02, 3.01)),
  feature(10, 700, 55.7, rectangle(3, 3, 3.02, 3.01)),
], {
  getHeight,
  polygonSets,
  metersPerLongitude: 80_700,
  metersPerLatitude: 111_320,
})

assert.deepEqual(selected.map(({ properties }) => properties.OBJECTID), [2, 4, 6, 7, 8, 9])
console.log('building geometry check passed')
