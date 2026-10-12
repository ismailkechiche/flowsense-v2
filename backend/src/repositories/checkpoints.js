'use strict';

const { NOW_LOCAL } = require('./sql');

const COLUMNS = 'id, name, area, servers, sla_wait_minutes, active, created_at, updated_at';
const UPDATABLE = ['name', 'area', 'servers', 'sla_wait_minutes', 'active'];

function toCheckpoint(row) {
  return row && { ...row, active: row.active === 1 };
}

function createCheckpointsRepository(db) {
  const byId = db.prepare(`SELECT ${COLUMNS} FROM checkpoints WHERE id = ?`);
  const insert = db.prepare(`INSERT INTO checkpoints (name, area, servers, sla_wait_minutes, active)
    VALUES (@name, @area, @servers, @sla_wait_minutes, @active)`);

  return {
    findById: (id) => toCheckpoint(byId.get(id)),
    list({ activeOnly = false } = {}) {
      const where = activeOnly ? 'WHERE active = 1' : '';
      return db.prepare(`SELECT ${COLUMNS} FROM checkpoints ${where} ORDER BY id`).all().map(toCheckpoint);
    },
    insert(checkpoint) {
      const info = insert.run({ ...checkpoint, active: checkpoint.active === false ? 0 : 1 });
      return Number(info.lastInsertRowid);
    },
    /** Updates only the given fields; column names come from a fixed list. */
    update(id, fields) {
      const keys = Object.keys(fields).filter((key) => UPDATABLE.includes(key));
      if (keys.length === 0) return;
      const params = { id };
      for (const key of keys) params[key] = key === 'active' ? (fields[key] ? 1 : 0) : fields[key];
      const assignments = keys.map((key) => `${key} = @${key}`).join(', ');
      db.prepare(`UPDATE checkpoints SET ${assignments}, updated_at = ${NOW_LOCAL} WHERE id = @id`).run(params);
    },
  };
}

module.exports = { createCheckpointsRepository };
