'use strict';

/**
 * Shared analytics fixture: three sessions on two checkpoints and two
 * dates. A family of 6 waits 30 minutes while solo travellers walk straight
 * through, so plain row averages and pax-weighted averages differ.
 * Rows: [pax, arrival, service start, service end, counter, flight].
 */
const SECURITY = 2;
const PASSPORT = 3;
const GATE = 4;
const SLA = 10; // Security and Passport Control

const SESSIONS = [
  { name: 'Security day 1', date: '2026-05-01', checkpoint_id: SECURITY, rows: [
    [6, '08:00', '08:30', '08:36', 'S1', 'TU100'],
    [1, '08:05', '08:05', '08:07', 'S2', 'TU100'],
    [1, '08:10', '08:10', '08:12', 'S2', null],
  ] },
  { name: 'Security day 2', date: '2026-05-02', checkpoint_id: SECURITY, rows: [
    [2, '14:00', '14:04', '14:08', null, null],
    [4, '14:20', '14:32', '14:40', null, 'AF200'],
  ] },
  { name: 'Passport day 1', date: '2026-05-01', checkpoint_id: PASSPORT, rows: [
    [3, '09:00', '09:02', '09:05', 'P1', 'TU100'],
  ] },
];

const minutes = (a, b) => (Date.parse(`2000-01-01T${b}:00Z`) - Date.parse(`2000-01-01T${a}:00Z`)) / 60000;

/** The fixture as flat rows with computed minutes, for the JS reference functions. */
const FLAT = SESSIONS.flatMap((s) => s.rows.map(([pax, arrival, start, end, counter, flight]) => ({
  checkpoint_id: s.checkpoint_id, date: s.date, hour: Number(arrival.slice(0, 2)), pax, counter, flight,
  wait: minutes(arrival, start), processing: minutes(start, end), total: minutes(arrival, end), sla: SLA,
})));

/** Creates the sessions and observations through the services, as `user`. */
function seed(t, user, sessions = SESSIONS) {
  const ids = [];
  for (const s of sessions) {
    const session = t.services.sessions.create(user, { name: s.name, date: s.date, checkpoint_id: s.checkpoint_id });
    ids.push(session.id);
    for (const [pax, arrival, start, end, counter, flight] of s.rows) {
      t.services.observations.create(user, session.id, {
        pax, counter, flight_no: flight,
        arrival_time: `${s.date}T${arrival}:00`, service_start: `${s.date}T${start}:00`, service_end: `${s.date}T${end}:00`,
      });
    }
  }
  return ids;
}

module.exports = { SECURITY, PASSPORT, GATE, SLA, SESSIONS, FLAT, seed };
