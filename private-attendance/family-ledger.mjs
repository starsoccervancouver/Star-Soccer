// The ledger is read on demand after the staff permission check. Monetary totals
// come from the ledger's reconciliation fields, including sibling allocations.
const recordId = /^rec[A-Za-z0-9]{14}$/;
const familyFields = ['Family', 'Guardian name', 'Email', 'Phone', 'Players', 'Website Registrations', 'Bookings', 'Payments',
  'Balance CAD', 'Balance status', 'Due now total CAD', 'Verified family receipts CAD', 'Unpriced bookings'];
const linkedFields = {
  players: ['Player','Verified applied total CAD','Outstanding CAD','Payment status'],
  registrations: ['Reference', 'Child', 'Weekday', 'Requested option', 'Next session date', 'Status', 'Registration kind', 'Processing notes'],
  bookings: ['Booking reference', 'Booking type', 'Booking status', 'Start date', 'Covered dates', 'Agreed booked CAD', 'Verified applied CAD', 'Balance CAD', 'Payment attention', 'Player'],
  payments: ['Payment reference', 'Payment date', 'Method', 'Direction', 'Verification', 'Amount CAD']
};
const money = value => Number.isFinite(value) ? value : null;
const balanceFields = ['Balance CAD','Due now total CAD','Verified family receipts CAD'];
const balancesOf = fields => ({
  balance:money(fields[balanceFields[0]]),dueNow:money(fields[balanceFields[1]]),verifiedReceipts:money(fields[balanceFields[2]])
});
function familyName(fields, players) {
  const guardian = fields['Guardian name']?.trim();
  const child = players.find(player => player.name)?.name;
  return [guardian, child].filter(Boolean).join(' / ') || fields.Family || 'Unnamed family';
}

export function createFamilyLedger(read, {clock = Date.now} = {}) {
  let recentDirectory;
  async function related(table, ids, familyId) {
    if (ids === undefined) return [];
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !recordId.test(id))) throw Error('INVALID_FAMILY_LINK');
    const results = [];
    const unique = [...new Set(ids)];
    // Up to one 100-record Airtable page per bounded list of validated IDs.
    const pageSize = 100;
    for (let offset = 0; offset < unique.length; offset += pageSize) {
      const batch = unique.slice(offset, offset + pageSize);
      const rows = await read(table, ['Family', ...linkedFields[table]], batch);
      const returned = new Set(rows.map(row => row.id));
      if (rows.length !== batch.length || batch.some(id => !returned.has(id)) || rows.some(row => row.fields.Family?.length !== 1 || row.fields.Family[0] !== familyId)) {
        throw Error('INCONSISTENT_FAMILY_LINK');
      }
      results.push(...rows);
    }
    return results;
  }
  async function readDirectory() {
    const [rows, players] = await Promise.all([
      read('families', ['Family', 'Guardian name', 'Players']), read('players', ['Player', 'Family'])
    ]);
    const byId = new Map(players.map(player => [player.id, player.fields]));
    return rows.map(({id, fields}) => {
      const linked = [...new Set(fields.Players || [])].filter(playerId => {
        const parents = byId.get(playerId)?.Family;
        return parents?.length === 1 && parents[0] === id;
      });
      return {id, playerIds:linked, name:familyName(fields, linked.map(playerId => ({name:byId.get(playerId).Player})))};
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    async balances() {
      return (await read('families',balanceFields)).map(({id,fields}) => ({familyId:id,...balancesOf(fields)}));
    },
    async parentContact(playerId, includeEmail) {
      if (!recordId.test(playerId)) throw Error('INVALID_PLAYER');
      const [player] = await read('players', ['Family','Player status'], [playerId]);
      const links = player?.fields.Family;
      if (player?.id !== playerId || player.fields['Player status']==='Inactive' || links?.length !== 1 || !recordId.test(links[0])) return null;
      const fields = includeEmail ? ['Phone','Email'] : ['Phone'];
      const [family] = await read('families', fields, links);
      if (family?.id !== links[0]) return null;
      return {phone:family.fields.Phone || null, ...(includeEmail ? {email:family.fields.Email || null} : {})};
    },
    invalidateDirectory() {
      recentDirectory = undefined;
    },
    async directory({reuseRecent = false} = {}) {
      if (!reuseRecent) return readDirectory();
      const now = clock();
      if (!recentDirectory || now >= recentDirectory.expires) {
        const lookup = readDirectory();
        recentDirectory = {expires: now + 30000, lookup};
        try { return await lookup; }
        catch (error) {
          if (recentDirectory?.lookup === lookup) recentDirectory = undefined;
          throw error;
        }
      }
      return recentDirectory.lookup;
    },
    async detail(id) {
      if (!recordId.test(id)) throw Error('INVALID_FAMILY');
      const [row] = await read('families', familyFields, [id]);
      if (!row || row.id !== id) return null;
      const f = row.fields;
      const players = await related('players', f.Players, id);
      const names = new Map(players.map(row => [row.id, row.fields]));
      const playerProfiles = [...new Set(f.Players || [])].map(id => {
        const p=names.get(id);
        return {id,name:p.Player,applied:money(p['Verified applied total CAD']),dueNow:money(p['Outstanding CAD']),paymentStatus:p['Payment status']};
      });
      const registrations = await related('registrations', f['Website Registrations'], id);
      const bookings = await related('bookings', f.Bookings, id);
      const payments = await related('payments', f.Payments, id);
      return {
        name: familyName(f, playerProfiles), guardian: f['Guardian name'], email: f.Email, phone: f.Phone,
        players: playerProfiles.map(player => player.name), playerProfiles, ...balancesOf(f), balanceStatus: f['Balance status'], unpricedBookings: f['Unpriced bookings'],
        registrations: registrations.map(({fields: r}) => ({reference: r.Reference, child: r.Child, program: r['Requested option'] || r['Registration kind'], weekday: r.Weekday, date: r['Next session date'], status: r.Status==='Processing'&&r['Processing notes']?.startsWith('Pending owner confirmation.')?'Pending confirmation':r.Status})),
        bookings: bookings.map(({fields: b}) => ({reference: b['Booking reference'], players: (b.Player || []).map(id => names.get(id)?.Player).filter(Boolean),
          type: b['Booking type'], status: b['Booking status'], dates: b['Covered dates'] || b['Start date'], balance: money(b['Balance CAD']), applied: money(b['Verified applied CAD'])})),
        payments: payments.map(({fields: p}) => ({reference: p['Payment reference'], date: p['Payment date'], method: p.Method, direction: p.Direction, verification: p.Verification, amount: money(p['Amount CAD'])}))
      };
    }
  };
}
