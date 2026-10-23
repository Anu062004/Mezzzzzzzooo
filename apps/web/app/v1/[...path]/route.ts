import {forwardApi} from '../../../lib/api-proxy';
export const dynamic='force-dynamic';
async function proxy(request:Request,{params}:{params:Promise<{path:string[]}>}){
 const origin=process.env.API_ORIGIN || (process.env.NODE_ENV==='development'?'http://127.0.0.1:3001':null);
 return forwardApi(request,(await params).path,origin);
}
export {proxy as GET,proxy as POST,proxy as PATCH,proxy as DELETE};
