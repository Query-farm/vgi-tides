-- Run from the project directory after make build.
SET allow_extension_repositories = 'allowed';
CREATE EXTENSION REPOSITORY IF NOT EXISTS query_farm
  WITH PREFIX 'https://duckdb-extensions.query.farm';
INSTALL vgi FROM query_farm;
LOAD vgi FROM query_farm;
INSTALL icu FROM core;
LOAD icu;
SET TimeZone = 'UTC';
ATTACH 'tides' (TYPE vgi, LOCATION './bin/vgi-tides-worker');

-- High and low tides at The Battery for tomorrow (UTC).
SELECT time, height_m, event_type, datum
FROM tides.main.tide_predictions(
  '8518750', CAST(current_date + 1 AS VARCHAR), CAST(current_date + 1 AS VARCHAR))
ORDER BY time;

-- Predicted slack, flood and ebb are a separate product from tide height.
SELECT time, event_type, velocity_major_mps, depth_m
FROM tides.main.current_predictions(
  'ACT0956', CAST(current_date + 1 AS VARCHAR), CAST(current_date + 1 AS VARCHAR))
ORDER BY time;

-- Discover observation-capable stations.
SELECT station_id, name, latitude, longitude
FROM tides.main.stations(station_kind := 'waterlevels')
WHERE state = 'NY' ORDER BY name;
