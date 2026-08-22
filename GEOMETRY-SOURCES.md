# Downtown Toronto building geometry sources

## Recommendation

Use the City of Toronto's 2025 3D Massing export as the geometry source of
record, but preprocess it into a small web-native artifact before changing the
app. It is the only candidate found that is both Toronto-specific and already
contains building massing plus height/elevation attributes.

Do not replace the current URL with another source directly. The app is a
browser-only Three.js bundle; the strongest alternatives are either large
download archives, cloud-native data, or an ArcGIS scene service.

## What was checked

The comparison bbox was `-79.4117,43.6276,-79.3498,43.6726`, roughly the
current downtown view. Counts below are source records whose centroid falls in
that bbox unless noted otherwise.

| Source | Downtown evidence | Strength | Problem |
| --- | ---: | --- | --- |
| [Toronto 3D Massing](https://open.toronto.ca/dataset/3d-massing/) (2025 SHP) | 17,922 features; all have `AVG_HEIGHT`; 2,631 are marked `3D Model` | Authoritative local massing, `AVG_HEIGHT`, `HEIGHT_MSL`, `SURF_ELEV`, and source fields | 81.4 MB ZIP / 210 MB SHP; not a browser API; Web Mercator coordinates despite the WGS84 filename |
| [Toronto 3D Massing](https://open.toronto.ca/dataset/3d-massing/) (2025 multipatch) | Same city-wide model as a 145.1 MB ZIP | True multipatch geometry | File geodatabase is not usable by this bundle without a converter |
| [Toronto LoD3 scene service](https://www.arcgis.com/home/item.html?id=039c1f9b8a2745a3853b75e0fde1892e) | Toronto-wide extent; 3D object layer | Ready-made 3D meshes | Created in 2016, exposes only `objectid`, and requires an I3S/ArcGIS renderer rather than the current Three.js extrusion path |
| [OpenStreetMap via Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) | 11,678 building ways; 3,028 had `building:levels` in the check | Live, editable, free geometry and some building parts/heights | Public Overpass is rate-limited; height coverage is incomplete; no stable municipal-style source IDs |
| [Overture buildings](https://docs.overturemaps.org/guides/buildings/) | Global coverage; `building` and OSM-sourced `building_part` features | Best external option for footprints plus `height`, `num_floors`, `min_height`, and parts | Delivered as GeoParquet/PMTiles, not a simple browser REST endpoint; ODbL attribution/share-alike obligations |
| [Microsoft Canadian footprints](https://github.com/microsoft/CanadianBuildingFootprints) | 3,781,847 Ontario footprints in the published breakdown | Broad Canadian footprint fallback; EPSG:4326 | Computer-generated footprints only, no height field; Ontario archive is about 808 MB unzipped |
| [Google Open Buildings](https://sites.research.google/open-buildings/) | Canada is not in the documented V3 country list | — | Not a Toronto source |

## Why the City export is worth preprocessing

The live layer currently used by `src/App.vue` is Toronto's
[Building Outline Polygon layer](https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/2).
It is convenient and queryable, but a downtown query returned 24,862 records,
including repeated `BUILDINGID` records with different heights and many null
`DERIVED_HEIGHT` values. The app therefore needs its current duplicate filtering
and an 8 m fallback height.

The 2025 massing SHP contains 428,184 city-wide polygon records. In the same
downtown bbox it returned 17,922 records, with this source breakdown:

```text
Photogrammetrics  14,091
3D Model           2,631
Site Plan          1,188
Lidar-Derived         12
```

`AVG_HEIGHT` was populated for all 17,922 checked records. The export's
metadata also shows that its `HEIGHT_MSL` value is calculated from
`AVG_HEIGHT + SURF_ELEV`, so the app can preserve both massing height and a
ground-relative base instead of inferring both from the live layer.

## Suggested implementation boundary

1. Convert the 2025 SHP to clipped GeoJSON or vector tiles outside the browser,
   retaining `AVG_HEIGHT`, `SURF_ELEV`, `HEIGHT_SRC`, and `BLDG_SRC`.
2. Keep the existing municipal ArcGIS query as the runtime fallback until the
   converted artifact is hosted and its footprint/height output is visually
   checked against downtown landmarks.
3. Consider Overture only if the app gains a backend or a deliberate PMTiles
   pipeline. Use OSM as an edit/fallback source, not as the primary 2.5 km
   scene feed.

