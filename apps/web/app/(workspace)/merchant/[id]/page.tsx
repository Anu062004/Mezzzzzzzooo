import {MerchantStore} from '../../../../components/workspace/Checkout';
export const metadata={title:'Merchant checkouts — MezoLoop'};
export default async function Page({params}:{params:Promise<{id:string}>}){return <MerchantStore id={(await params).id}/>;}
