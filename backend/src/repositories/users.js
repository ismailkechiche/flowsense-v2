'use strict';

const { NOW_LOCAL } = require('./sql');

const PUBLIC_COLUMNS = 'id, name, email, role, status, created_at, approved_by, approved_at';

function createUsersRepository(db) {
  const byId = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`);
  const credentialsByEmail = db.prepare(`SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = ?`);
  const credentialsById = db.prepare(`SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE id = ?`);
  const insert = db.prepare(`INSERT INTO users (name, email, password_hash, role, status, approved_by, approved_at)
    VALUES (@name, @email, @password_hash, @role, @status, @approved_by, @approved_at)`);
  const approve = db.prepare(`UPDATE users SET status = 'approved', role = @role, approved_by = @approved_by,
    approved_at = ${NOW_LOCAL} WHERE id = @id`);
  const setStatus = db.prepare('UPDATE users SET status = @status WHERE id = @id');
  const setRole = db.prepare('UPDATE users SET role = @role WHERE id = @id');
  const setPassword = db.prepare('UPDATE users SET password_hash = @password_hash WHERE id = @id');
  const countApprovedAdmins = db.prepare("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'approved'").pluck();

  return {
    findById: (id) => byId.get(id),
    findCredentialsByEmail: (email) => credentialsByEmail.get(email),
    findCredentialsById: (id) => credentialsById.get(id),
    list({ status } = {}) {
      const where = status ? 'WHERE status = ?' : '';
      const params = status ? [status] : [];
      return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users ${where}
        ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id DESC`).all(...params);
    },
    insert(user) {
      const info = insert.run({ approved_by: null, approved_at: null, ...user });
      return Number(info.lastInsertRowid);
    },
    approve: (id, role, approvedBy) => approve.run({ id, role, approved_by: approvedBy }),
    setStatus: (id, status) => setStatus.run({ id, status }),
    setRole: (id, role) => setRole.run({ id, role }),
    setPassword: (id, passwordHash) => setPassword.run({ id, password_hash: passwordHash }),
    countApprovedAdmins: () => countApprovedAdmins.get(),
  };
}

module.exports = { createUsersRepository };
