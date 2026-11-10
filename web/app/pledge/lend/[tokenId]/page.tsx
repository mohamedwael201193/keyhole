import {LenderView} from "./view";
export const metadata={title:"Review a loan · KEYHOLE"};
export default async function Page({params}:{params:Promise<{tokenId:string}>}) {const {tokenId}=await params;return <LenderView key={tokenId} tokenId={tokenId}/>;}
