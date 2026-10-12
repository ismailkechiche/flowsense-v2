-- The four standard checkpoints. Servers and SLA values are starting
-- defaults; admins adjust them from the Checkpoints screen.
INSERT INTO checkpoints (name, area, servers, sla_wait_minutes) VALUES
  ('Check-in',         'Departures hall', 8, 20),
  ('Security',         'Departures',      4, 10),
  ('Passport Control', 'Departures',      4, 10),
  ('Boarding Gate',    'Airside',         2, 15);
