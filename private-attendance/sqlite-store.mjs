import {DatabaseSync} from 'node:sqlite';
import {initializeStore} from './schema.mjs';
export function openStore(path=':memory:'){
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 if(path!==':memory:')db.exec('PRAGMA journal_mode=WAL;');
 const store={
  get(sql,...params){return db.prepare(sql).get(...params);},
  all(sql,...params){return db.prepare(sql).all(...params);},
  run(sql,...params){return params.length?db.prepare(sql).run(...params):db.exec(sql);},
  transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();if(result&&typeof result.then==='function')throw new Error('Transactions must be synchronous.');db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},
  close(){db.close();}
 };return initializeStore(store);
}
