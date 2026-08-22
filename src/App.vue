<template>
  <main class="app-shell">
    <div
      ref="viewport"
      class="viewport"
      :class="{ 'is-loading': loading, 'is-hovering': isHovering }"
      @pointermove="handlePointerMove"
      @pointerleave="handlePointerLeave"
      @click="handleViewportClick"
    >
      <div class="viewport-wash"></div>

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

    <aside class="focus-card panel">
      <div class="panel-kicker">
        <span>FOCUS POINT</span>
        <button class="text-button" type="button" @click.stop="resetView">RESET VIEW</button>
      </div>
      <div class="focus-title-row">
        <div class="location-pin">+</div>
        <div>
          <h2>Bay <span>/</span> Adelaide</h2>
          <p>Toronto, Ontario</p>
        </div>
      </div>
      <div class="coordinate-line">43°39′00.3″ N &nbsp;·&nbsp; 79°22′50.7″ W</div>
      <div class="panel-rule"></div>
      <div class="stats-grid">
        <div>
          <span>STRUCTURES</span>
          <strong>{{ structureCount }}</strong>
        </div>
        <div>
          <span>TALLEST MASS</span>
          <strong>{{ tallestHeight }}<small v-if="tallestHeight !== '—'"> m</small></strong>
        </div>
        <div>
          <span>STUDY AREA</span>
          <strong>{{ studyArea }}</strong>
        </div>
        <div>
          <span>HEIGHT SOURCE</span>
          <strong>DERIVED</strong>
        </div>
      </div>
    </aside>

    <aside v-if="selectedBuilding" class="selection-card panel">
      <div class="panel-kicker"><span>SELECTED MASSING</span><span class="selection-id">ID {{ selectedBuilding.id }}</span></div>
      <h2>Building outline</h2>
      <div class="selection-details">
        <div><span>HEIGHT</span><strong>{{ selectedBuilding.height }} m</strong></div>
        <div><span>BASE ELEVATION</span><strong>{{ selectedBuilding.elevation }} m</strong></div>
      </div>
      <p>{{ selectedBuilding.type }}</p>
    </aside>

    <aside class="legend-card panel">
      <div class="panel-kicker"><span>VERTICAL SCALE</span><span>METRES</span></div>
      <div class="legend-bar"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="legend-labels"><span>LOW</span><span>HIGH</span></div>
      <div class="legend-source">
        <span class="source-dot"></span>
        <span>CITY OF TORONTO / 3D MASSING</span>
      </div>
    </aside>

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

    <footer class="footer-bar">
      <span>BUILD 001&nbsp; / &nbsp;BAY—ADELAIDE NODE</span>
      <span class="footer-right">BUILDING OUTLINES + HEIGHT ATTRIBUTES&nbsp; / &nbsp;2026</span>
    </footer>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const viewport = ref(null)
const loading = ref(true)
const error = ref('')
const statusMessage = ref('Connecting to Toronto municipal data…')
const buildingCount = ref(0)
const tallest = ref(0)
const selectedBuilding = ref(null)
const isHovering = ref(false)

const CENTER = Object.freeze({ lat: 43.650085, lon: -79.38075 })
const RADIUS_METERS = 2_500
const PICK_RADIUS_METERS = 500
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

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0d171d)
scene.fog = new THREE.Fog(0x0d171d, 700, 2_600)

let renderer
let camera
let controls
let animationFrame
let marker
let buildingGroup
let roadGroup
let selectionOutline
let hoveredObject
let selectedObject
let lastStatusUpdate = 0
const seenBuildingIds = new Set()
const seenRoadIds = new Set()

const pointer = new THREE.Vector2()
const raycaster = new THREE.Raycaster()
const clock = new THREE.Clock()

const structureCount = computed(() => (buildingCount.value ? String(buildingCount.value).padStart(3, '0') : '—'))
const tallestHeight = computed(() => (tallest.value ? String(Math.round(tallest.value)) : '—'))
const studyArea = computed(() => `${((Math.PI * RADIUS_METERS ** 2) / 1_000_000).toFixed(1)} km²`)
const statusLabel = computed(() => (error.value ? 'SOURCE OFFLINE' : loading.value ? 'SYNCING DATA' : 'LIVE DATA'))

const colorPalette = [0x6e9697, 0x7f9a9a, 0xb18c6b, 0x8b7c83, 0x63818c]
const materialPairs = new Map()

function materialBucket(height) {
  return height > 180 ? 0 : height > 110 ? 1 : height > 55 ? 2 : 3
}

function getMaterialPair(height) {
  const bucket = materialBucket(height)
  if (!materialPairs.has(bucket)) {
    const sideColor = new THREE.Color(colorPalette[bucket])
    const roofColor = sideColor.clone().offsetHSL(0, -0.02, 0.1)
    materialPairs.set(bucket, [
      new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.9, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.95, flatShading: true }),
    ])
  }
  return materialPairs.get(bucket)
}

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

function featureDistanceMeters(feature) {
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
    (midpoint.lon - CENTER.lon) * METERS_PER_LONGITUDE,
    (midpoint.lat - CENTER.lat) * METERS_PER_LATITUDE,
  )
}

function getHeight(properties) {
  const derivedHeight = Number(properties?.DERIVED_HEIGHT)
  return Number.isFinite(derivedHeight) && derivedHeight > 0 ? Math.min(derivedHeight, 350) : 8
}

function getFeatureInfo(feature, baseElevation) {
  const properties = feature.properties || {}
  const height = getHeight(properties)
  const elevation = Number(properties.ELEVATION)
  return {
    id: properties.BUILDINGID || properties.OBJECTID || '—',
    height,
    elevation: Number.isFinite(elevation) ? Math.round(elevation - baseElevation) : 0,
    type: properties.SUBTYPE_DESC || 'Municipal building outline',
  }
}

function featureGeometries(feature, info, baseElevation) {
  const baseY = Math.max(0, (Number(feature.properties?.ELEVATION) - baseElevation) * SCALE)
  const parts = []

  for (const rings of polygonSets(feature.geometry)) {
    const shape = shapeFromRings(rings)
    if (!shape) continue

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: info.height * SCALE,
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

function addBuildings(collection) {
  const features = (collection.features || []).filter(
    (feature) => {
      // City record 152523 is an oversized 295 m complex envelope; the source has the accurate tower footprint separately.
      if (feature.properties?.OBJECTID === 152523) return false

      const id = feature.properties?.OBJECTID || feature.properties?.BUILDINGID
      if (!id || seenBuildingIds.has(id)) return false
      seenBuildingIds.add(id)
      return polygonSets(feature.geometry).length && featureDistanceMeters(feature) <= RADIUS_METERS
    },
  )

  const mergedParts = new Map()

  for (const feature of features) {
    const info = getFeatureInfo(feature, GROUND_ELEVATION)
    const parts = featureGeometries(feature, info, GROUND_ELEVATION)
    const isPickable = featureDistanceMeters(feature) <= PICK_RADIUS_METERS

    if (isPickable) {
      const group = new THREE.Group()
      group.userData.building = info
      group.name = `building-${info.id}`
      for (const geometry of parts) {
        const mesh = new THREE.Mesh(geometry, getMaterialPair(info.height))
        mesh.userData.building = info
        mesh.castShadow = false
        mesh.receiveShadow = true
        group.add(mesh)
      }
      if (group.children.length) buildingGroup.add(group)
    } else {
      const bucket = materialBucket(info.height)
      if (!mergedParts.has(bucket)) mergedParts.set(bucket, [])
      mergedParts.get(bucket).push(...parts)
    }
  }

  for (const [bucket, geometries] of mergedParts) {
    const merged = mergeGeometries(geometries, false)
    if (!merged) continue
    merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, getMaterialPair([240, 140, 80, 30][bucket]))
    mesh.userData.merged = true
    mesh.castShadow = false
    mesh.receiveShadow = true
    buildingGroup.add(mesh)
    geometries.forEach((geometry) => geometry.dispose())
  }

  buildingCount.value += features.length
  tallest.value = features.reduce((max, feature) => Math.max(max, getHeight(feature.properties)), tallest.value)
}

function addRoads(collection) {
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a2a30,
    roughness: 1,
    metalness: 0,
  })
  const roadEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x385057, transparent: true, opacity: 0.38 })

  const roadGeometries = []
  const roadEdges = []

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

      const edge = new THREE.EdgesGeometry(geometry)
      edge.translate(0, 0.005, 0)
      roadEdges.push(edge)
    }
  }

  const mergedRoads = mergeGeometries(roadGeometries, false)
  if (mergedRoads) roadGroup.add(new THREE.Mesh(mergedRoads, roadMaterial))
  roadGeometries.forEach((geometry) => geometry.dispose())

  const mergedEdges = mergeGeometries(roadEdges, false)
  if (mergedEdges) roadGroup.add(new THREE.LineSegments(mergedEdges, roadEdgeMaterial))
  roadEdges.forEach((geometry) => geometry.dispose())
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
    new THREE.MeshStandardMaterial({ color: 0x0f1d23, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.02
  ground.receiveShadow = true
  scene.add(ground)

  const grid = new THREE.GridHelper(MAP_SIZE, 50, 0x29434a, 0x1a2b31)
  grid.position.y = -0.01
  grid.material.transparent = true
  grid.material.opacity = 0.2
  scene.add(grid)

  roadGroup = new THREE.Group()
  buildingGroup = new THREE.Group()
  scene.add(roadGroup, buildingGroup)

  marker = new THREE.Group()
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(3.8, 4.25, 6),
    new THREE.MeshBasicMaterial({ color: 0xf0b67f, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
  )
  markerRing.rotation.x = -Math.PI / 2
  markerRing.position.y = 0.18
  marker.add(markerRing)

  const markerDot = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 6),
    new THREE.MeshBasicMaterial({ color: 0xf0b67f, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
  )
  markerDot.rotation.x = -Math.PI / 2
  markerDot.position.y = 0.17
  marker.add(markerDot)

  const markerStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 7.8, 6),
    new THREE.MeshBasicMaterial({ color: 0xf0b67f, transparent: true, opacity: 0.72 }),
  )
  markerStem.position.y = 3.9
  marker.add(markerStem)

  const markerHead = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.05, 0),
    new THREE.MeshStandardMaterial({ color: 0xf0b67f, emissive: 0x5c2e1a, emissiveIntensity: 0.4, flatShading: true }),
  )
  markerHead.position.y = 8.1
  marker.add(markerHead)
  scene.add(marker)
}

function resizeScene() {
  if (!renderer || !camera || !viewport.value) return
  const { clientWidth, clientHeight } = viewport.value
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(clientWidth, clientHeight, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
}

function findBuildingObject(object) {
  let current = object
  while (current) {
    if (current.userData?.building) return current
    current = current.parent
  }
  return null
}

function updatePointer(event) {
  const bounds = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
}

function hitBuilding(event) {
  if (!renderer || !buildingGroup) return null
  updatePointer(event)
  const intersections = raycaster.intersectObjects(buildingGroup.children, true)
  for (const intersection of intersections) {
    const building = findBuildingObject(intersection.object)
    if (building) return building
  }
  return null
}

function handlePointerMove(event) {
  const hit = hitBuilding(event)
  hoveredObject = hit
  isHovering.value = Boolean(hit)
}

function handlePointerLeave() {
  hoveredObject = null
  isHovering.value = false
}

function clearSelectionOutline() {
  if (selectionOutline?.parent) selectionOutline.parent.remove(selectionOutline)
  selectionOutline?.geometry.dispose()
  selectionOutline?.material.dispose()
  selectionOutline = null
}

function selectBuilding(object) {
  clearSelectionOutline()
  selectedObject = object
  selectedBuilding.value = object?.userData.building || null
  if (!object || !object.isMesh) return

  selectionOutline = new THREE.LineSegments(
    new THREE.EdgesGeometry(object.geometry, 18),
    new THREE.LineBasicMaterial({ color: 0xf4c69a, transparent: true, opacity: 0.95 }),
  )
  selectionOutline.scale.setScalar(1.002)
  object.add(selectionOutline)
}

function handleViewportClick(event) {
  if (loading.value) return
  const hit = hitBuilding(event)
  selectBuilding(hit)
}

function resetView() {
  if (!camera || !controls) return
  camera.position.set(126, 104, 126)
  controls.target.set(0, 0, 0)
  controls.update()
  selectBuilding(null)
}

function animate() {
  animationFrame = requestAnimationFrame(animate)
  const delta = clock.getDelta()
  controls?.update()

  if (marker) {
    marker.rotation.y += delta * 0.28
    marker.children[0].material.opacity = 0.72 + Math.sin(clock.elapsedTime * 2.1) * 0.18
  }

  if (renderer && camera) renderer.render(scene, camera)

  if (performance.now() - lastStatusUpdate > 500) {
    lastStatusUpdate = performance.now()
    if (camera && controls) {
      document.documentElement.style.setProperty('--camera-height', `${Math.round(camera.position.y)}px`)
    }
  }
}

onMounted(() => {
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
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.minDistance = 34
  controls.maxDistance = 1_500
  controls.minPolarAngle = 0.25
  controls.maxPolarAngle = Math.PI / 2.02
  controls.enablePan = true
  controls.screenSpacePanning = false
  controls.update()

  window.addEventListener('resize', resizeScene)
  animate()
  loadMapData()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  window.removeEventListener('resize', resizeScene)
  clearSelectionOutline()
  controls?.dispose()
  renderer?.dispose()
})
</script>
