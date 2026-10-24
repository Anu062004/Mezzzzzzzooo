'use client';
import {useEffect,useState} from 'react';
import {api,errorMessage} from '../../lib/api';
export function usePaymentStatus(id:string|null,revision=0){
 const [state,setState]=useState<{id:string|null;data:any;error:string}>({id:null,data:null,error:''});
 useEffect(()=>{
  if(!id)return;let active=true;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  async function poll(){
   try{const data=await api(`/orders/${id}/status`,{signal:controller.signal});if(active)setState({id,data,error:''});}
   catch(e){if(active)setState(previous=>({id,data:previous.id===id?previous.data:null,error:errorMessage(e)}));}
   if(active)timer=setTimeout(poll,5000);
  }
  void poll();return()=>{active=false;controller.abort();clearTimeout(timer);};
 },[id,revision]);
 return state.id===id?state:{id,data:null,error:''};
}
