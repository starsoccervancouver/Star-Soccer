import {randomBytes,createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
export function createOwnerAuth({store,clock=()=>Date.now()}){
 store.run('CREATE TABLE IF NOT EXISTS owner_tickets(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0)');
 return {issue(){const token=randomBytes(32).toString('base64url'),expiresAt=clock()+300000;store.run('DELETE FROM owner_tickets WHERE expires_at<?',clock());store.run('INSERT INTO owner_tickets VALUES(?,?,0)',hash(token),expiresAt);return {token,expiresAt:new Date(expiresAt).toISOString()};},redeem(token){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return false;return store.transaction(()=>{const t=store.get('SELECT * FROM owner_tickets WHERE token_hash=?',hash(token));if(!t||t.used||t.expires_at<=clock())return false;store.run('UPDATE owner_tickets SET used=1 WHERE token_hash=?',hash(token));return true;});}};
}
