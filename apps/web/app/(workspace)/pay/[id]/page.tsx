import Checkout from '../../../../components/workspace/Checkout';
export const metadata={title:'Review payment — MezoLoop'};
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <Checkout key={id} id={id}/>;}
