<template>
  <main class="app-shell">
    <div
      ref="viewport"
      class="viewport"
      :class="{ 'is-loading': loading }"
    >
      <div v-if="loading" class="loading-state">
        <span class="loading-orbit"></span>
        <p>{{ statusMessage }}</p>
      </div>

      <div v-if="error" class="data-error">
        <span class="error-mark">!</span>
        <div>
          <strong>City data is unavailable</strong>
          <p>{{ error }}</p>
        </div>
      </div>
    </div>

    <aside
      v-if="selectedCompany"
      class="company-card"
      aria-live="polite"
      @pointerdown.stop
    >
      <button class="company-card-close" type="button" aria-label="Close company details" @click="clearCompanySelection">×</button>
      <p class="eyebrow"><span></span> GREGSLIST MARKER</p>
      <h2>{{ selectedCompany.name }}</h2>
      <p v-if="selectedCompany.address" class="company-address">{{ selectedCompany.address }}</p>
      <p v-else class="company-address company-address-missing">Address not listed</p>
      <a href="https://gregslist.com/toronto/" target="_blank" rel="noreferrer">OPEN SOURCE LIST ↗</a>
    </aside>

    <section v-if="showMobileTutorial" class="mobile-tutorial" aria-labelledby="tutorial-title">
      <div class="tutorial-card">
        <div class="tutorial-progress" aria-hidden="true">
          <span v-for="(_, index) in tutorialSteps" :key="index" :class="{ active: index === tutorialStep }"></span>
        </div>
        <p class="eyebrow"><span></span> TOUCH CONTROLS</p>
        <h2 id="tutorial-title">{{ tutorialSteps[tutorialStep].title }}</h2>
        <div class="gesture-demo" :class="`gesture-${tutorialSteps[tutorialStep].gesture}`" aria-hidden="true">
          <i class="finger finger-one"></i>
          <i class="finger finger-two"></i>
          <span class="gesture-line"></span>
        </div>
        <p>{{ tutorialSteps[tutorialStep].description }}</p>
        <button type="button" @click="advanceTutorial">
          {{ tutorialStep === tutorialSteps.length - 1 ? 'GOT IT' : 'NEXT' }}
        </button>
        <button v-if="tutorialStep < tutorialSteps.length - 1" class="tutorial-skip" type="button" @click="dismissTutorial">
          SKIP
        </button>
      </div>
    </section>

    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></div>
        <div>
          <div class="brand-name">TORONTO</div>
          <div class="brand-subtitle">LOW-POLY CITY STUDY / 01</div>
        </div>
      </div>

      <div class="topbar-status">
        <span class="status-dot" :class="{ 'is-offline': error }"></span>
        <span>{{ statusLabel }}</span>
        <span class="status-divider"></span>
        <span class="status-coordinates">43.6501° N / 79.3808° W</span>
      </div>
    </header>

    <section class="intro-copy">
      <p class="eyebrow"><span></span> FINANCIAL DISTRICT / LIVE MASSING</p>
      <h1>Toronto<br /><em>in layers.</em></h1>
      <p class="intro-description">
        A navigable city fragment built from municipal building outlines and derived heights.
      </p>
    </section>

    <div class="compass" aria-label="North is up">
      <span class="compass-north">N</span>
      <span class="compass-cross vertical"></span>
      <span class="compass-cross horizontal"></span>
      <span class="compass-center"></span>
    </div>

    <div class="control-hint">
      <span class="mouse-icon"><i></i></span>
      <span><strong>DRAG</strong> TO ORBIT</span>
      <span class="hint-divider"></span>
      <span><strong>SCROLL</strong> TO ZOOM</span>
    </div>

    <input
      v-model.number="zoomRate"
      class="zoom-slider"
      type="range"
      min="-1"
      max="1"
      step="0.01"
      aria-label="Zoom speed"
      @pointerup="resetZoom"
      @pointercancel="resetZoom"
      @keyup="resetZoom"
      @blur="resetZoom"
    />

    <footer class="footer-bar">
      <span>BUILD 001&nbsp; / &nbsp;BAY—ADELAIDE NODE</span>
      <span class="footer-right">BUILDING OUTLINES + HEIGHT ATTRIBUTES&nbsp; / &nbsp;2026</span>
      <span class="footer-source">COMPANY DATA / <a href="https://gregslist.com/toronto/interactive-map/" target="_blank" rel="noreferrer">GREGSLIST MAP</a> / <a href="https://gregslist.com/toronto/" target="_blank" rel="noreferrer">SOURCE LIST</a></span>
    </footer>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { pointInRing, selectBuildingFeatures } from './building-geometry.js'
import companyData from './companies.json'
import { selectCompanyRecords } from './company-data.js'

const viewport = ref(null)
const loading = ref(true)
const error = ref('')
const statusMessage = ref('Connecting to Toronto municipal data…')
const showMobileTutorial = ref(false)
const tutorialStep = ref(0)
const zoomRate = ref(0)
const selectedCompany = ref(null)
const tutorialSteps = [
  { title: 'Zoom the city', description: 'Pinch or stretch with two fingers to zoom in and out.', gesture: 'zoom' },
  { title: 'Pan the camera', description: 'Drag with one finger to move across the city.', gesture: 'pan' },
  { title: 'Rotate the view', description: 'Keep one finger still and move the other to rotate the camera.', gesture: 'rotate' },
]

const CENTER = Object.freeze({ lat: 43.650085, lon: -79.38075 })
const PAN_RADIUS_METERS = 1_000
const RADIUS_METERS = 2_500
const TILE_METERS = 750
// ponytail: fixed downtown datum keeps center-out tiles aligned; terrain needs a real surface before this becomes dynamic.
const GROUND_ELEVATION = 80
const SCALE = 0.2
const METERS_PER_LATITUDE = 111_320
const METERS_PER_LONGITUDE = METERS_PER_LATITUDE * Math.cos((CENTER.lat * Math.PI) / 180)
const MAP_SIZE = RADIUS_METERS * SCALE * 2 + 100
const PAGE_SIZE = 2_000
const REQUEST_TIMEOUT_MS = 15_000
const REQUEST_RETRIES = 1
const BUILDING_LAYER = 'https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/2/query'
const ROAD_LAYER = 'https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/3/query'
const sceneCompanies = selectCompanyRecords(companyData, {
  center: { lat: CENTER.lat, lng: CENTER.lon },
  radiusMeters: RADIUS_METERS,
})

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0d171d)
scene.fog = new THREE.Fog(0x000000, 1_000 * SCALE, RADIUS_METERS * SCALE)

let renderer
let camera
let controls
let animationFrame
let buildingGroup
let roadGroup
let companyGroup
let selectedMarker
let lastStatusUpdate = 0
let twoFingerMode
const touchPositions = new Map()
const touchMovement = new Map()
const pointerStarts = new Map()
const seenBuildingIds = new Set()
const seenRoadIds = new Set()
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

const clock = new THREE.Clock()

const statusLabel = computed(() => (error.value ? 'SOURCE OFFLINE' : loading.value ? 'SYNCING DATA' : 'LIVE DATA'))

function createCompanyMarkerTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  context.beginPath()
  context.arc(32, 32, 24, 0, Math.PI * 2)
  context.fillStyle = '#ffffff'
  context.fill()
  return new THREE.CanvasTexture(canvas)
}

const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0x6e9697, roughness: 0.9, flatShading: true })
const companyMarkerTexture = createCompanyMarkerTexture()
const companyMarkerMaterial = new THREE.SpriteMaterial({
  map: companyMarkerTexture,
  color: 0xf0b67f,
  transparent: true,
  depthTest: false,
  depthWrite: false,
})
const selectedCompanyMarkerMaterial = new THREE.SpriteMaterial({
  map: companyMarkerTexture,
  color: 0xffedc8,
  transparent: true,
  depthTest: false,
  depthWrite: false,
})
const COMPANY_MARKER_SIZE = 7
const COMPANY_MARKER_FALLBACK_Y = 18
const COMPANY_MARKERS_VISIBLE = false
const buildingPlacements = []

function projectCoordinate([longitude, latitude]) {
  return {
    x: (longitude - CENTER.lon) * METERS_PER_LONGITUDE * SCALE,
    z: (latitude - CENTER.lat) * METERS_PER_LATITUDE * SCALE,
  }
}

function pathFromRing(ring) {
  return ring.map((coordinate) => {
    const point = projectCoordinate(coordinate)
    return new THREE.Vector2(point.x, point.z)
  })
}

function shapeFromRings(rings) {
  if (!rings?.[0]?.length) return null

  const shape = new THREE.Shape(pathFromRing(rings[0]))
  for (const hole of rings.slice(1)) {
    if (hole.length) shape.holes.push(new THREE.Path(pathFromRing(hole)))
  }
  return shape
}

function polygonSets(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function featureDistanceMeters(feature, coordinate = [CENTER.lon, CENTER.lat]) {
  const ring = polygonSets(feature.geometry)[0]?.[0]
  if (!ring?.length) return Infinity

  const midpoint = ring.reduce(
    (sum, [longitude, latitude]) => {
      sum.lon += longitude
      sum.lat += latitude
      return sum
    },
    { lon: 0, lat: 0 },
  )
  midpoint.lon /= ring.length
  midpoint.lat /= ring.length

  return Math.hypot(
    (midpoint.lon - coordinate[0]) * METERS_PER_LONGITUDE,
    (midpoint.lat - coordinate[1]) * METERS_PER_LATITUDE,
  )
}

function featureContainsCoordinate(feature, coordinate) {
  return polygonSets(feature.geometry).some((rings) => {
    if (!rings[0]?.length || !pointInRing(coordinate, rings[0])) return false
    return !rings.slice(1).some((hole) => pointInRing(coordinate, hole))
  })
}

function getHeight(properties) {
  const derivedHeight = Number(properties?.DERIVED_HEIGHT)
  return Number.isFinite(derivedHeight) && derivedHeight > 0 ? Math.min(derivedHeight, 350) : 8
}

function featureBaseY(feature, baseElevation = GROUND_ELEVATION) {
  const elevation = Number(feature.properties?.ELEVATION)
  return Number.isFinite(elevation) ? Math.max(0, (elevation - baseElevation) * SCALE) : 0
}

function featureGeometries(feature, height, baseElevation) {
  const baseY = featureBaseY(feature, baseElevation)
  const parts = []

  for (const rings of polygonSets(feature.geometry)) {
    const shape = shapeFromRings(rings)
    if (!shape) continue

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: height * SCALE,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1,
    })
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, baseY, 0)
    parts.push(geometry)
  }

  return parts
}

function markerHeightForCompany(company) {
  const coordinate = [company.lng, company.lat]
  const building = buildingPlacements.find(({ feature }) => featureContainsCoordinate(feature, coordinate))
  if (building) return building.topY

  let nearest
  for (const placement of buildingPlacements) {
    const distance = featureDistanceMeters(placement.feature, coordinate)
    if (!nearest || distance < nearest.distance) nearest = { distance, placement }
  }

  return nearest?.distance <= 75 ? nearest.placement.topY : COMPANY_MARKER_FALLBACK_Y
}

// ponytail: one-time O(companies × buildings) placement scan; add a spatial index if either dataset grows.
function positionCompanyMarkers() {
  for (const marker of companyGroup?.children || []) marker.position.y = markerHeightForCompany(marker.userData.company)
}

function setCompanyMarkerSelected(marker, selected) {
  marker.scale.setScalar(COMPANY_MARKER_SIZE * (selected ? 1.35 : 1))
  marker.material = selected ? selectedCompanyMarkerMaterial : companyMarkerMaterial
}

function addCompanyMarkers() {
  for (const company of sceneCompanies) {
    const point = projectCoordinate([company.lng, company.lat])
    const marker = new THREE.Sprite(companyMarkerMaterial)
    marker.position.set(point.x, COMPANY_MARKER_FALLBACK_Y, point.z)
    marker.scale.setScalar(COMPANY_MARKER_SIZE)
    marker.userData.company = company
    marker.userData.companyMarker = marker
    companyGroup.add(marker)
  }
}

function addBuildings(collection) {
  const features = selectBuildingFeatures((collection.features || []).filter(
    (feature) => {
      const id = feature.properties?.OBJECTID || feature.properties?.BUILDINGID
      if (!id || seenBuildingIds.has(id)) return false
      seenBuildingIds.add(id)
      return polygonSets(feature.geometry).length && featureDistanceMeters(feature) <= RADIUS_METERS
    },
  ), { getHeight, polygonSets, metersPerLongitude: METERS_PER_LONGITUDE, metersPerLatitude: METERS_PER_LATITUDE })

  for (const feature of features) {
    const height = getHeight(feature.properties)
    const parts = featureGeometries(feature, height, GROUND_ELEVATION)
    buildingPlacements.push({
      feature,
      topY: featureBaseY(feature) + height * SCALE + 1.5,
    })
    for (const geometry of parts) {
      const mesh = new THREE.Mesh(geometry, buildingMaterial)
      mesh.castShadow = false
      mesh.receiveShadow = true
      buildingGroup.add(mesh)
    }
  }

}

function addRoads(collection) {
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a2a30,
    roughness: 1,
    metalness: 0,
    // Road polygons overlap at intersections; avoid coplanar fragments fighting in the depth buffer.
    depthWrite: false,
  })

  const roadGeometries = []

  for (const feature of collection.features || []) {
    const id = feature.properties?.OBJECTID
    if (!id || seenRoadIds.has(id)) continue
    seenRoadIds.add(id)

    for (const rings of polygonSets(feature.geometry)) {
      const shape = shapeFromRings(rings)
      if (!shape) continue

      const geometry = new THREE.ShapeGeometry(shape)
      geometry.rotateX(-Math.PI / 2)
      geometry.translate(0, 0.04, 0)
      roadGeometries.push(geometry)
    }
  }

  const mergedRoads = roadGeometries.length ? mergeGeometries(roadGeometries, false) : null
  if (mergedRoads) roadGroup.add(new THREE.Mesh(mergedRoads, roadMaterial))
  roadGeometries.forEach((geometry) => geometry.dispose())
}

function tileOrder() {
  const maxTile = Math.ceil(RADIUS_METERS / TILE_METERS)
  const size = maxTile * 2 + 1

  return Array.from({ length: size ** 2 }, (_, index) => {
    const tx = (index % size) - maxTile
    const ty = Math.floor(index / size) - maxTile
    return { tx, ty, distance: Math.hypot(tx * TILE_METERS, ty * TILE_METERS) }
  })
    .filter((tile) => tile.distance <= RADIUS_METERS + TILE_METERS)
    .sort((a, b) => a.distance - b.distance || a.ty - b.ty || a.tx - b.tx)
}

function tileBounds(tile) {
  const halfTile = TILE_METERS / 2
  const westMeters = tile.tx * TILE_METERS - halfTile
  const eastMeters = tile.tx * TILE_METERS + halfTile
  const southMeters = tile.ty * TILE_METERS - halfTile
  const northMeters = tile.ty * TILE_METERS + halfTile

  return {
    west: CENTER.lon + westMeters / METERS_PER_LONGITUDE,
    south: CENTER.lat + southMeters / METERS_PER_LATITUDE,
    east: CENTER.lon + eastMeters / METERS_PER_LONGITUDE,
    north: CENTER.lat + northMeters / METERS_PER_LATITUDE,
  }
}

async function queryTile(url, fields, label, tile) {
  const bounds = tileBounds(tile)
  const baseParams = new URLSearchParams({
    where: '1=1',
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: fields,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(PAGE_SIZE),
    f: 'geojson',
  })

  const features = []
  let resultOffset = 0

  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams(baseParams)
    params.set('resultOffset', String(resultOffset))
    const data = await requestJson(`${url}?${params}`, label)
    if (data.error) throw new Error(data.error.message || 'The city data service returned an error.')

    const pageFeatures = data.features || []
    features.push(...pageFeatures)
    statusMessage.value = `${label} / ${features.length.toLocaleString()} loaded`
    resultOffset += pageFeatures.length

    const exceededLimit = data.exceededTransferLimit || data.properties?.exceededTransferLimit
    if (!pageFeatures.length || (!exceededLimit && pageFeatures.length < PAGE_SIZE)) break
  }

  return { type: 'FeatureCollection', features }
}

async function requestJson(url, label) {
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`Request failed (${response.status})`)
      return await response.json()
    } catch (requestError) {
      if (attempt === REQUEST_RETRIES) {
        const reason = requestError.name === 'AbortError' ? 'timed out' : requestError.message
        throw new Error(`${label} ${reason}`)
      }
      statusMessage.value = `${label} / retrying`
      await new Promise((resolve) => setTimeout(resolve, 300))
    } finally {
      clearTimeout(timeout)
    }
  }
}

async function loadMapData() {
  const tiles = tileOrder()
  const errors = []

  for (const [index, tile] of tiles.entries()) {
    const tileLabel = `TILE ${index + 1}/${tiles.length}`
    statusMessage.value = `${tileLabel} / loading center-out`
    const [buildings, roads] = await Promise.allSettled([
      queryTile(BUILDING_LAYER, 'OBJECTID,BUILDINGID,DERIVED_HEIGHT,ELEVATION,SUBTYPE_DESC', `${tileLabel} BUILDINGS`, tile),
      queryTile(ROAD_LAYER, 'OBJECTID', `${tileLabel} ROADS`, tile),
    ])

    if (buildings.status === 'fulfilled') addBuildings(buildings.value)
    else errors.push(buildings.reason?.message || `${tileLabel} building request failed`)

    if (roads.status === 'fulfilled') addRoads(roads.value)
    else errors.push(roads.reason?.message || `${tileLabel} road request failed`)

    await new Promise((resolve) => requestAnimationFrame(resolve))
  }

  positionCompanyMarkers()
  if (errors.length) error.value = `${errors.length} municipal tile request${errors.length === 1 ? '' : 's'} failed.`

  loading.value = false
  statusMessage.value = error.value ? 'Showing available scene layers' : 'Municipal layers loaded center-out'
}

function createScene() {
  scene.add(new THREE.HemisphereLight(0x9fb9b2, 0x10181d, 1.8))

  const keyLight = new THREE.DirectionalLight(0xf5d1a8, 2.15)
  keyLight.position.set(-90, 190, 110)
  scene.add(keyLight)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x0f1d23, roughness: 1, depthWrite: false }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.02
  ground.receiveShadow = true
  scene.add(ground)

  const grid = new THREE.GridHelper(MAP_SIZE, 50, 0x29434a, 0x1a2b31)
  grid.position.y = -0.01
  grid.material.transparent = true
  grid.material.opacity = 0.2
  grid.material.depthWrite = false
  scene.add(grid)

  roadGroup = new THREE.Group()
  buildingGroup = new THREE.Group()
  companyGroup = new THREE.Group()
  companyGroup.visible = COMPANY_MARKERS_VISIBLE
  scene.add(roadGroup, buildingGroup, companyGroup)
  addCompanyMarkers()

}

function resizeScene() {
  if (!renderer || !camera || !viewport.value) return
  const { clientWidth, clientHeight } = viewport.value
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(clientWidth, clientHeight, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
}

function animate() {
  animationFrame = requestAnimationFrame(animate)
  const delta = clock.getDelta()
  if (zoomRate.value && camera && controls) {
    const distance = THREE.MathUtils.clamp(
      controls.getDistance() * Math.exp(-zoomRate.value * delta * 0.5),
      controls.minDistance,
      controls.maxDistance,
    )
    camera.position.sub(controls.target).setLength(distance).add(controls.target)
  }
  controls?.update()

  if (renderer && camera) renderer.render(scene, camera)

  if (performance.now() - lastStatusUpdate > 500) {
    lastStatusUpdate = performance.now()
    if (camera && controls) {
      document.documentElement.style.setProperty('--camera-height', `${Math.round(camera.position.y)}px`)
    }
  }
}

function resetZoom() {
  zoomRate.value = 0
}

function handleTouchPointer(event) {
  if (event.pointerType !== 'touch') return

  if (event.type === 'pointerdown') {
    touchPositions.set(event.pointerId, { x: event.pageX, y: event.pageY })
    touchMovement.set(event.pointerId, 0)
    if (touchPositions.size === 2) twoFingerMode = undefined
    return
  }

  if (event.type === 'pointerup' || event.type === 'pointercancel') {
    touchPositions.delete(event.pointerId)
    touchMovement.delete(event.pointerId)
    if (touchPositions.size < 2) twoFingerMode = undefined
    return
  }

  if (event.pointerType !== 'touch' || touchPositions.size !== 2) return

  const previous = touchPositions.get(event.pointerId)
  const otherEntry = [...touchPositions].find(([id]) => id !== event.pointerId)
  const other = otherEntry?.[1]
  if (!previous || !other) return

  const moved = Math.hypot(event.pageX - previous.x, event.pageY - previous.y)
  const otherMoved = touchMovement.get(otherEntry[0]) || 0
  const distance = Math.hypot(event.pageX - other.x, event.pageY - other.y)
  const previousDistance = Math.hypot(previous.x - other.x, previous.y - other.y)

  touchPositions.set(event.pointerId, { x: event.pageX, y: event.pageY })
  touchMovement.set(event.pointerId, moved)
  if (!twoFingerMode) {
    if (moved < 2 && otherMoved < 2) return
    twoFingerMode = otherMoved >= 2 && moved >= 2 && Math.abs(distance - previousDistance) > 2 ? 'zoom' : 'rotate'
  }

  controls._trackPointer(event)
  event.stopImmediatePropagation()
  if (twoFingerMode === 'zoom') controls._handleTouchMoveDolly(event)
  else controls._handleTouchMoveRotate(event)
  controls.update()
}

function handleCompanyPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return
  pointerStarts.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false })
}

function handleCompanyPointerMove(event) {
  const start = pointerStarts.get(event.pointerId)
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) start.moved = true
}

function clearCompanySelection() {
  if (selectedMarker) setCompanyMarkerSelected(selectedMarker, false)
  selectedMarker = undefined
  selectedCompany.value = null
}

function selectCompanyAt(event) {
  if (!renderer || !camera || !companyGroup?.visible) return
  const bounds = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)

  const hit = raycaster.intersectObjects(companyGroup.children, true)[0]
  if (!hit?.object.userData.company) {
    clearCompanySelection()
    return
  }

  if (selectedMarker !== hit.object.userData.companyMarker) {
    if (selectedMarker) setCompanyMarkerSelected(selectedMarker, false)
    selectedMarker = hit.object.userData.companyMarker
    setCompanyMarkerSelected(selectedMarker, true)
  }
  selectedCompany.value = hit.object.userData.company
}

function handleCompanyPointerUp(event) {
  const start = pointerStarts.get(event.pointerId)
  pointerStarts.delete(event.pointerId)
  if (!start || start.moved || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return
  selectCompanyAt(event)
}

function handleCompanyPointerCancel(event) {
  pointerStarts.delete(event.pointerId)
}

function handleKeydown(event) {
  if (event.key === 'Escape') clearCompanySelection()
}

function dismissTutorial() {
  showMobileTutorial.value = false
  localStorage.setItem('toronto-tech-map-mobile-tutorial-seen', '1')
}

function advanceTutorial() {
  if (tutorialStep.value === tutorialSteps.length - 1) dismissTutorial()
  else tutorialStep.value += 1
}

onMounted(() => {
  showMobileTutorial.value = window.matchMedia('(pointer: coarse)').matches && !localStorage.getItem('toronto-tech-map-mobile-tutorial-seen')
  createScene()

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(viewport.value.clientWidth, viewport.value.clientHeight, false)
  viewport.value.appendChild(renderer.domElement)

  camera = new THREE.PerspectiveCamera(42, viewport.value.clientWidth / viewport.value.clientHeight, 0.1, 4_000)
  camera.position.set(126, 104, 126)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, 0)
  controls.maxTargetRadius = PAN_RADIUS_METERS * SCALE
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.panSpeed = 2
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  }
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  }
  controls.minDistance = 34
  controls.maxDistance = 1_500
  controls.minPolarAngle = 0.25
  controls.maxPolarAngle = Math.PI / 2.02
  controls.enablePan = true
  controls.screenSpacePanning = false
  controls.update()

  renderer.domElement.addEventListener('pointerdown', handleTouchPointer, { capture: true })
  renderer.domElement.addEventListener('pointermove', handleTouchPointer, { capture: true })
  renderer.domElement.addEventListener('pointerup', handleTouchPointer, { capture: true })
  renderer.domElement.addEventListener('pointercancel', handleTouchPointer, { capture: true })
  renderer.domElement.addEventListener('pointerdown', handleCompanyPointerDown)
  renderer.domElement.addEventListener('pointermove', handleCompanyPointerMove)
  renderer.domElement.addEventListener('pointerup', handleCompanyPointerUp)
  renderer.domElement.addEventListener('pointercancel', handleCompanyPointerCancel)

  window.addEventListener('resize', resizeScene)
  window.addEventListener('keydown', handleKeydown)
  animate()
  loadMapData()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  window.removeEventListener('resize', resizeScene)
  controls?.dispose()
  renderer?.domElement.removeEventListener('pointerdown', handleTouchPointer, { capture: true })
  renderer?.domElement.removeEventListener('pointermove', handleTouchPointer, { capture: true })
  renderer?.domElement.removeEventListener('pointerup', handleTouchPointer, { capture: true })
  renderer?.domElement.removeEventListener('pointercancel', handleTouchPointer, { capture: true })
  renderer?.domElement.removeEventListener('pointerdown', handleCompanyPointerDown)
  renderer?.domElement.removeEventListener('pointermove', handleCompanyPointerMove)
  renderer?.domElement.removeEventListener('pointerup', handleCompanyPointerUp)
  renderer?.domElement.removeEventListener('pointercancel', handleCompanyPointerCancel)
  window.removeEventListener('keydown', handleKeydown)
  renderer?.dispose()
})
</script>
