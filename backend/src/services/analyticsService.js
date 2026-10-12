'use strict';

const {
  paxWeightedAvg, throughputPerHour, arrivalRate, serviceRate,
} = require('../domain/metrics');
const { mmc, recommendServers, QueueInputError, MAX_SERVERS } = require('../domain/queueing');
const { HISTOGRAM_BIN_MINUTES, HISTOGRAM_LAST_BIN } = require('../repositories/analytics');
const { badRequest, notFound } = require('../domain/errors');

const BREAKDOWN_LIMIT = 200;

/**
 * Throughput, λ, μ and c for a set of sessions (step-0 decision for
 * multi-day scopes):
 * - throughput and λ divide by the SUM of each session's own window, so
 *   nights and gaps between sessions don't count as observed time;
 * - c is the pax-weighted average of the distinct counters seen per session
 *   (a session with none recorded counts as the checkpoint's `servers`),
 *   rounded, at least 1.
 */
function rates(sessions) {
  let pax = 0;
  let serviceWindow = 0;
  let arrivalWindow = 0;
  let processing = 0;
  for (const s of sessions) {
    pax += s.pax_total;
    serviceWindow += s.service_window_minutes;
    arrivalWindow += s.arrival_window_minutes;
    processing += s.processing_minutes_sum;
  }
  const withCounters = sessions.filter((s) => s.counter_count > 0).length;
  const servers = paxWeightedAvg(sessions.map((s) => ({ pax: s.pax_total, c: s.counter_count > 0 ? s.counter_count : s.servers })), 'c');
  return {
    pax_total: pax,
    observed_minutes: serviceWindow,
    arrival_window_minutes: arrivalWindow,
    throughput_per_hour: throughputPerHour(pax, serviceWindow),
    lambda: arrivalRate(pax, arrivalWindow),
    mu: serviceRate(pax, processing),
    c: servers === null ? null : Math.max(1, Math.round(servers)),
    c_source: withCounters === sessions.length ? 'counters' : (withCounters === 0 ? 'configured' : 'mixed'),
  };
}

/** M/M/c model and staffing advice for one checkpoint's observed rates. */
function staffing(r, slaMinutes) {
  if (r.lambda === null || r.mu === null || r.c === null) {
    return { model: null, recommended_servers: null, recommended_exceeds_max: false, sla_status: 'not_enough_data' };
  }
  const model = mmc(r.lambda, r.mu, r.c);
  const advice = recommendServers(r.lambda, r.mu, slaMinutes);
  let status = 'ok';
  if (model.overloaded) status = 'overloaded';
  else if (model.wq > slaMinutes) status = 'breach';
  return {
    model, recommended_servers: advice.servers, recommended_exceeds_max: advice.exceeded, sla_status: status,
  };
}

// Severity (step-0 assumption 22): overloaded first, then the largest
// Wq − SLA gap, then the highest ρ; checkpoints without enough data last.
function bySeverity(a, b) {
  const rank = (x) => (x.sla_status === 'overloaded' ? 0 : (x.model ? 1 : 2));
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 1) {
    const gap = (b.model.wq - b.sla_wait_minutes) - (a.model.wq - a.sla_wait_minutes);
    if (gap !== 0) return gap;
  }
  const rho = (b.model?.rho ?? 0) - (a.model?.rho ?? 0);
  return rho !== 0 ? rho : a.checkpoint_name.localeCompare(b.checkpoint_name);
}

function createAnalyticsService({ repos }) {
  const analytics = repos.analytics;

  function bottlenecks(filters) {
    const windows = analytics.sessionWindows(filters);
    return analytics.byCheckpoint(filters).map((cp) => {
      const r = rates(windows.filter((w) => w.checkpoint_id === cp.checkpoint_id));
      return {
        checkpoint_id: cp.checkpoint_id,
        checkpoint_name: cp.checkpoint_name,
        sla_wait_minutes: cp.sla_wait_minutes,
        configured_servers: cp.servers,
        pax_total: cp.pax_total,
        group_count: cp.group_count,
        avg_wait_minutes: cp.avg_wait_minutes,
        sla_compliance_pct: cp.sla_compliance_pct,
        breach_pax: cp.breach_pax,
        breach_groups: cp.breach_groups,
        lambda: r.lambda,
        mu: r.mu,
        c: r.c,
        c_source: r.c_source,
        ...staffing(r, cp.sla_wait_minutes),
      };
    }).sort(bySeverity);
  }

  return {
    /** Overview KPIs (dashboard section 1). */
    summary(filters) {
      const kpis = analytics.overview(filters);
      const r = rates(analytics.sessionWindows(filters));
      const thresholds = analytics.slaThresholds(filters);
      return {
        ...kpis,
        p50_wait_minutes: analytics.waitPercentile(filters, 50),
        p90_wait_minutes: analytics.waitPercentile(filters, 90),
        throughput_per_hour: r.throughput_per_hour,
        observed_minutes: r.observed_minutes,
        // A single threshold when every checkpoint in scope shares it, so the
        // UI can flag the average wait; otherwise null (breaches still count).
        sla_wait_minutes: thresholds.length === 1 ? thresholds[0] : null,
      };
    },

    /** Bottlenecks and staffing per checkpoint (section 2). */
    bottlenecks: (filters) => ({ items: bottlenecks(filters), max_servers: MAX_SERVERS }),

    /**
     * Per hour of day (section 3). Throughput here is passengers arriving in
     * that hour divided by the number of days that hour was observed.
     */
    hourly(filters) {
      return {
        items: analytics.hourly(filters).map((row) => ({
          ...row, throughput_per_hour: row.days_observed > 0 ? row.pax_total / row.days_observed : null,
        })),
      };
    },

    /** Per flight and per counter (section 4); empty lists when not recorded. */
    breakdown(filters) {
      const flights = analytics.breakdown(filters, 'flight_no', BREAKDOWN_LIMIT);
      const counters = analytics.breakdown(filters, 'counter', BREAKDOWN_LIMIT);
      return {
        flights: flights.items, flights_total: flights.total,
        counters: counters.items, counters_total: counters.total,
        limit: BREAKDOWN_LIMIT,
      };
    },

    /** Pax-weighted wait histogram, 5-minute bins (section 5). */
    distribution(filters) {
      const counts = new Map(analytics.waitHistogram(filters).map((row) => [row.bin, row]));
      const bins = [];
      for (let bin = 0; bin <= HISTOGRAM_LAST_BIN; bin += 1) {
        const row = counts.get(bin);
        bins.push({
          from_minutes: bin * HISTOGRAM_BIN_MINUTES,
          to_minutes: bin === HISTOGRAM_LAST_BIN ? null : (bin + 1) * HISTOGRAM_BIN_MINUTES,
          pax: row?.pax ?? 0,
          group_count: row?.group_count ?? 0,
        });
      }
      return { bin_minutes: HISTOGRAM_BIN_MINUTES, bins, sla_thresholds: analytics.slaThresholds(filters) };
    },

    /** Daily pax-weighted wait and SLA compliance (section 6). */
    trend: (filters) => ({ items: analytics.trend(filters) }),

    /** Observed λ, μ, c and SLA for one checkpoint, to pre-fill the simulator. */
    simulatorDefaults(checkpointId, filters) {
      const checkpoint = repos.checkpoints.findById(checkpointId);
      if (!checkpoint) throw notFound('Checkpoint not found');
      const scoped = { ...filters, checkpointIds: [checkpointId] };
      const r = rates(analytics.sessionWindows(scoped));
      return {
        checkpoint_id: checkpoint.id,
        checkpoint_name: checkpoint.name,
        sla_wait_minutes: checkpoint.sla_wait_minutes,
        configured_servers: checkpoint.servers,
        pax_total: r.pax_total,
        lambda: r.lambda,
        mu: r.mu,
        c: r.c ?? checkpoint.servers,
        c_source: r.pax_total > 0 ? r.c_source : 'configured',
      };
    },

    /** One M/M/c run plus the servers needed for the SLA (simulator). */
    simulate({ lambda, mu, c, sla_minutes: slaMinutes }) {
      try {
        const advice = recommendServers(lambda, mu, slaMinutes);
        return {
          ...mmc(lambda, mu, c),
          sla_minutes: slaMinutes,
          recommended_servers: advice.servers,
          recommended_exceeds_max: advice.exceeded,
          max_servers: MAX_SERVERS,
        };
      } catch (err) {
        if (err instanceof QueueInputError) throw badRequest(err.message, undefined, 'invalid_queue_input');
        throw err;
      }
    },
  };
}

module.exports = { createAnalyticsService, rates };
