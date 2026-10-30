import {randomBytes} from 'node:crypto';
import {CoachError} from './coach-store.mjs';

export const requestId=()=>randomBytes(16).toString('hex');
// Shared validators run in both browser and server code and do not import CoachError.
const validationCodes=new Set(['INVALID_DIAGRAM','INVALID_PLAN']);
// Only application errors are public. Never retain exception text, URLs, bodies or identities.
export function safeFailure(error){
 const validation=validationCodes.has(error?.code)&&error?.status===400;
 const trusted=validation||error instanceof CoachError&&/^[A-Z_]{1,60}$/.test(error.code);
 const code=trusted?error.code:'SERVICE_UNAVAILABLE';
 const status=trusted&&Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:503;
 return {code,status,retryable:(status===429||status>=500)&&!['ATTENDANCE_WRITES_DISABLED','ATTENDANCE_SYNC_PENDING'].includes(code)};
}
export function logFailure(error,id,operation='coach-request'){
 const failure=safeFailure(error);
 console.warn(JSON.stringify({event:'coach_request_failed',requestId:id,operation,error:failure.code,status:failure.status,retryable:failure.retryable}));
 return failure;
}
