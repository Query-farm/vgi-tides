/**
 * Example queries that combine two or more of this worker's objects.
 *
 * Each SQL is defined once here and referenced from the object that drives the
 * query (so agents see it on that object) and from the schema-level list.
 * Dates are historical so the NOAA results do not move from day to day.
 */

export interface Example {
  description: string;
  sql: string;
}

/** Observed water levels joined to six-minute tide predictions: the weather-driven residual. */
export const DAILY_SURGE_RESIDUAL: Example = {
  description:
    "Daily range of the storm-surge residual (observed minus predicted water level, metres) at The Battery for 1–7 January 2026, " +
    "joining six-minute observations to six-minute tide predictions on time; days follow the session time zone (set UTC)",
  sql:
    "SELECT CAST(o.time AS DATE) AS obs_day, round(max(o.height_m - p.height_m), 3) AS max_residual_m, " +
    "round(min(o.height_m - p.height_m), 3) AS min_residual_m, count(o.height_m) AS samples " +
    "FROM tides.main.water_levels('8518750', '2026-01-01', '2026-01-07') AS o " +
    "JOIN tides.main.tide_predictions('8518750', '2026-01-01', '2026-01-07', step := '6') AS p USING (time) " +
    "GROUP BY obs_day ORDER BY obs_day",
};

/** Each predicted high tide against the highest water level actually observed within an hour of it. */
export const HIGH_TIDE_VS_OBSERVED: Example = {
  description:
    "Compare each predicted high tide at The Battery on 1–3 January 2026 with the highest observed water level within an hour of it; " +
    "surge_m is observed peak minus predicted height",
  sql:
    "SELECT p.time AS predicted_high, p.height_m AS predicted_m, max(o.height_m) AS observed_peak_m, " +
    "round(max(o.height_m) - p.height_m, 3) AS surge_m " +
    "FROM tides.main.tide_predictions('8518750', '2026-01-01', '2026-01-03') AS p " +
    "JOIN tides.main.water_levels('8518750', '2026-01-01', '2026-01-03') AS o " +
    "ON o.time BETWEEN p.time - INTERVAL 1 HOUR AND p.time + INTERVAL 1 HOUR " +
    "WHERE p.event_type = 'H' GROUP BY p.time, p.height_m ORDER BY p.time",
};

/** All-bin current observations joined to the current-meter bin depths: a speed profile by depth. */
export const SPEED_BY_DEPTH: Example = {
  description:
    "Mean and peak observed current speed by sensor depth at Cape Henry (cb0102) on 1 January 2026, " +
    "joining all-bin observations to the current-meter bin depths",
  sql:
    "SELECT b.bin, b.depth_m, round(avg(c.speed_mps), 3) AS mean_speed_mps, round(max(c.speed_mps), 3) AS max_speed_mps " +
    "FROM tides.main.currents('cb0102', '2026-01-01', '2026-01-01') AS c " +
    "JOIN tides.main.current_bins('cb0102') AS b USING (bin) GROUP BY b.bin, b.depth_m ORDER BY b.bin",
};

/** Predicted slack/flood/ebb events checked against the observed speed around each event. */
export const PREDICTED_EVENTS_VS_OBSERVED: Example = {
  description:
    "Check each predicted slack, maximum flood and maximum ebb at the Chesapeake Bay entrance (cb0102, bin 4) on 1 January 2026 " +
    "against the mean observed speed within 15 minutes of the event",
  sql:
    "SELECT p.time, p.event_type, round(abs(p.velocity_major_mps), 2) AS predicted_speed_mps, " +
    "round(avg(o.speed_mps), 2) AS observed_speed_mps, count(o.speed_mps) AS observations " +
    "FROM tides.main.current_predictions('cb0102', '2026-01-01', '2026-01-01', bin := 4) AS p " +
    "JOIN tides.main.currents('cb0102', '2026-01-01', '2026-01-01', bin := 4) AS o " +
    "ON o.time BETWEEN p.time - INTERVAL 15 MINUTE AND p.time + INTERVAL 15 MINUTE " +
    "GROUP BY p.time, p.event_type, p.velocity_major_mps ORDER BY p.time",
};

export const COMPOSED_EXAMPLES: Example[] = [
  DAILY_SURGE_RESIDUAL,
  HIGH_TIDE_VS_OBSERVED,
  SPEED_BY_DEPTH,
  PREDICTED_EVENTS_VS_OBSERVED,
];
