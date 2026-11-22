import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

// Only an opaque identifier and a boolean are persisted. New conversation messages get their own mark.
export function reportCompletions(storage, secret) {
  const signature = (kind, id) => createHmac('sha256', secret).update('report-completion:' + kind + ':' + id).digest('base64url');
  const storageKey = id => 'report:done:' + id;

  async function include(kind, page) {
    const rows = page.items.map(item => {
      const version = kind === 'inquiries' || kind === 'other' ? item.messageId : '';
      const id = createHash('sha256').update(JSON.stringify([kind, item.key, version])).digest('base64url');
      return { id, item };
    });
    const keys = [...new Set(rows.map(row => storageKey(row.id)))];
    const completed = new Set();
    for (let i = 0; i < keys.length; i += 128) {
      const saved = await storage.get(keys.slice(i, i + 128));
      for (const key of saved.keys()) completed.add(key);
    }
    return { ...page, items: rows.map(({id, item}) => ({
      ...item, completionToken: id + '.' + signature(kind, id), completed: completed.has(storageKey(id))
    })) };
  }

  async function set(kind, token, completed) {
    if (typeof token !== 'string' || !/^[\w-]{43}\.[\w-]{43}$/.test(token) || typeof completed !== 'boolean') throw Error('INVALID_REQUEST');
    const [id, mac] = token.split('.');
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(signature(kind, id)))) throw Error('INVALID_REQUEST');
    if (completed) await storage.put(storageKey(id), true);
    else await storage.delete(storageKey(id));
    return { completed };
  }
  return { include, set };
}
