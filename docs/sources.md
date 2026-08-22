# Downtown Toronto building geometry sources

## Recommendation

Use the City of Toronto's [2025 3D Massing dataset](https://open.toronto.ca/dataset/3d-massing/)
as the primary geometry source, but preprocess it into a small web-native
artifact before loading it in the app.

The practical shape of the solution is:

1. Convert the 2025 SHP export outside the browser.
2. Clip it to the downtown view plus a small buffer.
3. Publish the result as GeoJSON or vector tiles.
4. Keep the current [municipal ArcGIS layer](https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/2)
   as a runtime fallback.

This is the best fit because it is Toronto-specific, includes building massing
and height/elevation attributes, and avoids making the browser parse a large
geodatabase or a proprietary 3D scene format.

## Comparison

| Source | Strength | Limitation |
| --- | --- | --- |
| **Toronto 2025 3D Massing** | Local authoritative massing with `AVG_HEIGHT`, `HEIGHT_MSL`, `SURF_ELEV`, `HEIGHT_SRC`, and `BLDG_SRC` | The SHP download is large and is not a browser API; it needs preprocessing |
| **Current Toronto ArcGIS layer** | Already queryable as GeoJSON/PBF and works with the existing app | Downtown queries contain repeated `BUILDINGID` records and many null `DERIVED_HEIGHT` values |
| **Overture buildings** | Global footprints with `height`, `num_floors`, and OSM-sourced `building_part` features; see the [buildings guide](https://docs.overturemaps.org/guides/buildings/) | Data is delivered as GeoParquet/PMTiles rather than a simple REST endpoint; ODbL attribution and sharing obligations apply |
| **OpenStreetMap / Overpass** | Live, editable geometry with some heights, levels, and building parts | Public Overpass endpoints are rate-limited; height coverage is incomplete and IDs are not municipal IDs |
| **Microsoft Canadian footprints** | Broad Canadian footprint coverage; see the [Canadian dataset](https://github.com/microsoft/CanadianBuildingFootprints) | Computer-generated footprints without equivalent height data; the Ontario archive is too large for direct browser loading |
| **Google Open Buildings** | Useful ML-derived footprint dataset in covered regions | Canada is not in the documented V3 coverage list; not a Toronto option |
| **Toronto LoD3 scene service** | Ready-made 3D meshes; see the [ArcGIS item](https://www.arcgis.com/home/item.html?id=039c1f9b8a2745a3853b75e0fde1892e) | From 2016, exposes minimal attributes, and requires an I3S/ArcGIS renderer instead of the current Three.js extrusion path |

## Evidence from the downtown check

The comparison bbox was `-79.4117,43.6276,-79.3498,43.6726`, approximately the
current downtown view.

- The 2025 massing SHP contains 428,184 city-wide polygon records.
- 17,922 massing records fall in the downtown bbox, and all checked records
  have `AVG_HEIGHT`.
- Those downtown records are sourced as 14,091 `Photogrammetrics`, 2,631
  `3D Model`, 1,188 `Site Plan`, and 12 `Lidar-Derived` features.
- The current municipal layer returned 24,862 records in the same query area,
  including repeated building IDs and null derived heights.
- An Overpass check returned 11,678 building ways, with 3,028 carrying
  `building:levels`.

## Decision boundary

The 2025 City export is the primary choice when geometry quality matters. The
current ArcGIS layer is the simplest fallback while the converted artifact is
being prepared. Overture becomes worth the extra infrastructure only if the
app gains a backend or a deliberate PMTiles pipeline; OSM is better treated as
an edit/fallback source than as the primary 2.5 km scene feed.

