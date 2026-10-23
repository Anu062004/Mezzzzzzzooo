export class ApiError extends Error {
 constructor(public code:string,public status=0){super(messages[code] || code.toLowerCase().replaceAll('_',' '));}
}
const messages:Record<string,string>={
 API_UNAVAILABLE:'The service is temporarily unavailable. Please try again shortly.',
 API_NOT_CONFIGURED:'The payment service is not connected yet. You can explore the workspace; live actions will be available when setup is complete.',
 AUTH_REQUIRED:'Connect your wallet and sign in to continue.',SESSION_EXPIRED:'Your session expired. Please reconnect your wallet.',
 INSUFFICIENT_MUSD:'Your wallet does not have enough MUSD for this payment.',ORDER_EXPIRED:'This checkout has expired. Ask the merchant for a new link.',
 ORDER_NOT_PAYABLE:'This checkout is no longer payable. Refresh to see its latest status.',
 ROUTER_NOT_CONFIGURED:'Payments are not enabled yet. The payment contract must be deployed first.',
 CHAIN_NOT_CONFIGURED:'This on-chain feature is not enabled yet.',SIGNATURE_VERIFICATION_UNAVAILABLE:'Wallet verification is temporarily unavailable. Please try again.',
 INVALID_INPUT:'Please check the form values and try again.',MERCHANT_ACCESS_DENIED:'This wallet does not have access to that merchant.',
};
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
 let response:Response;
 try{response=await fetch(`/v1${path}`,{...options,credentials:'same-origin',cache:'no-store',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},signal:options.signal??AbortSignal.timeout(20000)});}catch{throw new ApiError('API_UNAVAILABLE');}
 if(response.status===204)return undefined as T;
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new ApiError(data?.error?.code || 'API_UNAVAILABLE',response.status);
 if(!data)throw new ApiError('API_UNAVAILABLE');return data as T;
}
export const post=<T=any>(path:string,body?:unknown,headers?:Record<string,string>)=>api<T>(path,{method:'POST',body:body===undefined?undefined:JSON.stringify(body),headers});
export const errorMessage=(error:unknown)=>error instanceof Error?error.message:'Something went wrong. Please try again.';
