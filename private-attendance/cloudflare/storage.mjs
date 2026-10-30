/* Adapter only; constructing it performs no writes. Cloudflare bindings are private. */
export function durableSqliteStore(storage) {
  if (!storage?.sql?.exec || typeof storage.transactionSync!=='function') throw new Error('SQLite-backed Durable Object storage required.');
  return Object.freeze({
    get(sql,...params) { return storage.sql.exec(sql,...params).toArray()[0]; },
    all(sql,...params) { return storage.sql.exec(sql,...params).toArray(); },
    run(sql,...params) { const cursor=storage.sql.exec(sql,...params);return {changes:cursor.rowsWritten??0,lastInsertRowid:null}; },
    transaction(fn) { return storage.transactionSync(fn); }
  });
}
