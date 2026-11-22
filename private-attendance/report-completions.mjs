import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';

const legacyKey = id => 'report:done:' + id;
const prefix = kind => 'report:history:' + kind + ':';
const validId = /^[\w-]{43}$/;
const equal = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const identity = (kind, item) => createHash('sha256').update(JSON.stringify([
  kind, item.key, kind === 'inquiries' || kind === 'other' ? item.messageId : ''
])).digest('base64url');

export function reportCompletions(storage, secret) {
  const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
  const tokenFor = (kind, id) => id + '.' + sign('report-completion:' + kind + ':' + id);
  function present(kind, id, item, entry) {
    // The signed copy lets a still-open browser complete a row even after the live queue changes.
    const {key, messageId, title, status, date, href} = item;
    const snapshot = Buffer.from(JSON.stringify({key,messageId,title,status,date,href})).toString('base64url');
    return {...item, completionToken:tokenFor(kind,id), completed:entry?.completed === true,
      completedAt:entry?.completedAt ?? null, reopened:entry?.completed === false,
      receipt:snapshot + '.' + sign('report-row:' + kind + ':' + id + ':' + snapshot)};
  }
  async function include(kind, page) {
    const rows = page.items.map(item => ({id:identity(kind,item), item}));
    const keys = [...new Set(rows.flatMap(({id}) => [prefix(kind)+id, legacyKey(id)]))];
    const saved = new Map();
    for (let i=0; i<keys.length; i+=128) {
      for (const [key,value] of await storage.get(keys.slice(i,i+128))) saved.set(key,value);
    }
    const items = [];
    for (const {id,item} of rows) {
      const key=prefix(kind)+id;
      let entry=saved.get(key);
      if (!entry && saved.has(legacyKey(id))) {
        entry={item,completed:true,completedAt:null};
        await storage.put(key,entry);
        saved.set(key,entry);
      }
      items.push(present(kind,id,item,entry));
    }
    return {...page,items};
  }
  async function history(kind,cursor='',pageSize=50) {
    if (cursor && !validId.test(cursor)) throw Error('INVALID_REQUEST');
    const base=prefix(kind);
    const rows=await storage.list({prefix:base,...(cursor?{startAfter:base+cursor}:{}),limit:pageSize+1});
    const items=[...rows].slice(0,pageSize).map(([key,entry])=>present(kind,key.slice(base.length),entry.item,entry));
    return {items,next:rows.size>pageSize?items[pageSize-1].completionToken.split('.')[0]:null};
  }
  async function set(kind, token, completed, receipt) {
    if (typeof token!=='string'||!/^[\w-]{43}\.[\w-]{43}$/.test(token)||typeof completed!=='boolean') throw Error('INVALID_REQUEST');
    const id=token.split('.')[0];
    if (!equal(token,tokenFor(kind,id))) throw Error('INVALID_REQUEST');
    const key=prefix(kind)+id;
    const previous=await storage.get(key);
    let item=previous?.item;
    if (receipt!==undefined) {
      if (typeof receipt!=='string'||receipt.length>54000||!/^([\w-]+)\.([\w-]{43})$/.test(receipt)) throw Error('INVALID_REQUEST');
      const [snapshot,mac]=receipt.split('.');
      if (!equal(mac,sign('report-row:'+kind+':'+id+':'+snapshot))) throw Error('INVALID_REQUEST');
      item=JSON.parse(Buffer.from(snapshot,'base64url').toString('utf8'));
    }
    if (item) {
      const completedAt=completed?(previous?.completed?previous.completedAt:new Date().toISOString()):null;
      await storage.put(key,{item,completed,completedAt});
      return {completed,completedAt};
    }
    // Clients loaded before archive support can still complete a live item.
    if (completed) await storage.put(legacyKey(id),true);
    else await storage.delete(legacyKey(id));
    return {completed};
  }
  return {include,history,set};
}
