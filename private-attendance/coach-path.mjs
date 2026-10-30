export function validateCoachPath(value='/workspace'){
 if(typeof value!=='string'||!/^\/[a-z][a-z0-9-]{0,40}$/.test(value))throw Error('INVALID_COACH_PATH');
 return value;
}
export function normalizeCoachPath(path,basePath){
 return path===basePath||path.startsWith(basePath+'/')?'/workspace'+path.slice(basePath.length):null;
}
