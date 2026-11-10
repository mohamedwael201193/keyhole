"use client";
/** Test-only native-wallet adapter. No browser key, fake RPC, or production target override. */
import {useEffect,useMemo,useState,type Context,type ReactNode} from "react";
import type {WalletCtx} from "./wallet";
import type {Op,SignedAuth} from "./nep413";
import {sendKeysCalls,type KeysCall,type TxWallet} from "./keysTx";
import {PLEDGE_SANDBOX,KEYS_CONTRACT} from "./config";
async function fixture(action:string,params:Record<string,unknown>={}){if(!PLEDGE_SANDBOX||!["localhost","127.0.0.1"].includes(location.hostname))throw Error("Sandbox wallet requires a loopback-only fixture build");const r=await fetch("/api/pledge-sandbox",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...params})});const j=await r.json();if(!r.ok||j.error)throw Error(j.error?.message??"Sandbox fixture unavailable");return j;}
export function SandboxWalletProvider({context,children}:{context:Context<WalletCtx|null>;children:ReactNode}){
 const [account,setAccount]=useState<string|null>(null);
 useEffect(()=>{const a=sessionStorage.getItem("pledge-sandbox-wallet");if(a&&["ui-borrower.test.near","ui-lender.test.near"].includes(a))setAccount(a);},[]);
 const value=useMemo<WalletCtx>(()=>{
  const txWallet:TxWallet={signAndSendTransaction:p=>fixture("tx",{account_id:account,receiver_id:p.receiverId,actions:p.actions})};
  const send=(calls:readonly KeysCall[])=>sendKeysCalls(account?{kind:"nc",accountId:account,wallet:txWallet}:{kind:"none"},calls,KEYS_CONTRACT);
  return {accountId:account,ready:true,restoring:false,mismatch:null,connect(){setAccount("ui-borrower.test.near");sessionStorage.setItem("pledge-sandbox-wallet","ui-borrower.test.near");},connectNear:async()=>{},connectOther(){},connectMeteor:async()=>{},connectSocial(){},socialEnabled:false,via:account?"nc":null,socialCreating:false,socialFinishing:false,choosing:false,closeChooser(){},disconnect:async()=>{setAccount(null);sessionStorage.removeItem("pledge-sandbox-wallet");},sign:async(op:Op,params:Record<string,unknown>={})=>await fixture("sign",{account_id:account,op,params}) as SignedAuth,pending:null,clearPending(){},session:null,startSession:async()=>({ok:false,code:"explicit_test_signatures_only"}),revokeSession:async()=>{},sendTx:call=>send([call]),sendTxBatch:send};
 },[account]);const Provider=context.Provider;
 return <Provider value={value}><aside aria-label="Sandbox fixture" style={{position:"fixed",zIndex:1000,top:0,left:0,right:0,display:"flex",justifyContent:"center",gap:6,alignItems:"center",fontSize:8,padding:3,background:"#f2dc9f",color:"#253b2c"}}><b>Sandbox: native real / custody mocked</b>{["borrower","lender"].map(role=><button style={{fontSize:8,padding:"1px 4px"}} key={role} onClick={()=>{const a=`ui-${role}.test.near`;setAccount(a);sessionStorage.setItem("pledge-sandbox-wallet",a);}}>Use {role} wallet</button>)}</aside>{children}</Provider>;
}
