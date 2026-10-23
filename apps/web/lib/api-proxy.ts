const fail=(code:string,status:number)=>Response.json({error:{code,retryable:status===503}},{status,headers:{'Cache-Control':'no-store'}});
export async function forwardApi(request:Request,path:string[],origin:string|null){
 if(!origin)return fail('API_NOT_CONFIGURED',503);
 if(path.some(part=>!(/^[a-zA-Z0-9_-]+$/).test(part)))return fail('INVALID_INPUT',400);
 const headers=new Headers();
 for(const key of ['cookie','origin','content-type','idempotency-key']){const value=request.headers.get(key);if(value)headers.set(key,value);}
 // Preserve the browser Origin. The API independently enforces its configured public origin.
 let body:ArrayBuffer|undefined;
 if(!['GET','HEAD'].includes(request.method)&&request.body){
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();return fail('INVALID_INPUT',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}body=bytes.buffer;
 }
 try{
  const target=new URL(`/v1/${path.join('/')}`,origin);target.search=new URL(request.url).search;
  const upstream=await fetch(target,{method:request.method,headers,body,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});
  const output=new Headers({'Content-Type':upstream.headers.get('content-type')||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  for(const cookie of upstream.headers.getSetCookie())output.append('Set-Cookie',cookie);
  return new Response(upstream.body,{status:upstream.status,headers:output});
 }catch{return fail('API_UNAVAILABLE',503);}
}
