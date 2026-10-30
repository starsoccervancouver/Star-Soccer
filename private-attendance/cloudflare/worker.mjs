/* DELIBERATELY DISABLED hosting scaffold. No deployment or real-data writes are approved. */
import {durableSqliteStore} from './storage.mjs';

const disabled = () => new Response(JSON.stringify({error:'attendance_service_not_activated',draftOnly:true}),{
  status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});

// A future reviewed activation must wire the common authenticated HTTP handler and
// staff authentication here. No environment flag in this scaffold can activate it.
export default {async fetch() {return disabled();}};

export class AttendanceCoordinator {
  constructor(ctx,env) {this.ctx=ctx;this.env=env;this.store=durableSqliteStore(ctx.storage);}
  async fetch() {return disabled();}
}
