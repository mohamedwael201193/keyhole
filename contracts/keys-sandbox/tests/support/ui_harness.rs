//! Opt-in loopback real-native UI bridge. Custody HTTP/registry/WASI host are explicit mocks.
//! Generates disposable sandbox accounts in memory; never reads a user key, env credential, or mainnet account.
use super::*;
use near_workspaces::operations::Function;
use near_workspaces::types::Gas;
use sha2::{Digest,Sha256};
use tokio::io::{AsyncReadExt,AsyncWriteExt};

// Match the browser's FINAL clock, not near-workspaces' default optimistic head.
// Pin the template to that same anchor; never relax production future/expiry checks.
async fn ui_final_block(e:&E)->Result<near_workspaces::Block>{
 let head=e.w.view_block().await?;
 Ok(e.w.view_block().block_hash(*head.header().last_final_block()).await?)
}
async fn ui_setup()->Result<E>{
 let w=near_workspaces::sandbox().await?;let root=w.root_account()?;
 let c=account(&root,"ui-keys").await?.deploy(&std::fs::read(WASM)?).await?.into_result()?;
 let mock=account(&root,"ui-provider").await?.deploy(&std::fs::read(MOCK)?).await?.into_result()?;
 let alice=account(&root,"ui-borrower").await?;let lender=account(&root,"ui-lender").await?;
 let bob=account(&root,"ui-receiver").await?;let minter=account(&root,"ui-minter").await?;
 c.call("new").args_json(json!({"owner":c.id(),"minter":minter.id(),"treasury":c.id(),"royalty_bps":500})).max_gas().transact().await?.into_result()?;
 register_payouts(&c,&root,&[minter.id()]).await?;
 minter.call(c.id(),"nft_mint").args_json(json!({"token_id":"k1","receiver_id":alice.id(),"tier":1,"metadata":{"title":"UI sandbox collateral","copies":1}})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 minter.call(c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 let pk=SigningKey::from_bytes(&[7;32]).verifying_key().to_bytes();
 c.call("migrate_pledge").args_json(json!({"recovery_account":root.id(),"attestor_public_key":B64.encode(pk),"custody_contract":mock.id(),"network":"sandbox"})).max_gas().transact().await?.into_result()?;
 c.call("set_lending_enabled").args_json(json!({"enabled":true})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 minter.call(c.id(),"register_collateral").args_json(json!({"token_id":"k1","wallet_pubkey":format!("ed25519:{}","ab".repeat(32)),"encrypted_data":"sealed-policy","wallet_signature":"ab".repeat(64),"version":1,"valid_until":4_000_000_000u64})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&c,"get_collateral_binding",json!({"token_id":"k1"})).await["ready"],true);
 assert_eq!(view(&c,"payout_account_registered",json!({"account_id":alice.id()})).await,false);
 assert_eq!(view(&c,"payout_account_registered",json!({"account_id":lender.id()})).await,false);
 Ok(E{w,c,mock,alice,lender,bob,minter})
}
fn native_account(e:&E,id:&str)->Result<Account>{
 if id==e.alice.id().as_str(){Ok(e.alice.clone())}else if id==e.lender.id().as_str(){Ok(e.lender.clone())}else{anyhow::bail!("only the two disposable sandbox wallets are allowed")}
}
fn wall_ms()->u64{std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64}
fn sandbox_sign(a:&Account,op:&str,params:Value,n:u64)->Result<Value>{
 // These keys were generated above by near-workspaces. Secret bytes stay in process memory.
 let key=a.secret_key().to_string();let raw=bs58::decode(key.strip_prefix("ed25519:").unwrap()).into_vec()?;
 let seed:[u8;32]=raw[..32].try_into()?;let signer=SigningKey::from_bytes(&seed);
 let mut nonce=[0u8;32];nonce[..8].copy_from_slice(&n.to_le_bytes());nonce[8..16].copy_from_slice(&wall_ms().to_le_bytes());
 let message=json!({"op":op,"account_id":a.id(),"ts_ms":wall_ms(),"params":params}).to_string();
 let payload=keyhole_worker::nep413_bytes(&message,&nonce,"keyhole",None);
 let digest=Sha256::digest(&payload);
 Ok(json!({"account_id":a.id(),"public_key":a.secret_key().public_key().to_string(),"nonce":B64.encode(nonce),"message":message,"recipient":"keyhole","signature":B64.encode(signer.sign(&digest).to_bytes())}))
}
async fn private_auth(l:&mut Layer<'_>,input:&Value,op:&str)->Result<(Account,Value,Control)>{
 let auth:keyhole_worker::Auth=serde_json::from_value(input["auth"].clone())?;
 let (signed,nonce)=keyhole_worker::verify_nep413(&auth,"keyhole").map_err(|e|anyhow::anyhow!(e.message))?;
 anyhow::ensure!(signed.op==op&&signed.params["token_id"]=="k1","wrong signed op/token");
 anyhow::ensure!(wall_ms().abs_diff(signed.ts_ms)<=60_000,"stale signature");
 let a=native_account(l.e,&auth.account_id)?;
 anyhow::ensure!(auth.public_key==a.secret_key().public_key().to_string(),"wrong sandbox public key");
 let access=a.view_access_key(&a.secret_key().public_key()).await?;
 anyhow::ensure!(matches!(access.permission,near_workspaces::types::AccessKeyPermission::FullAccess),"native full-access key required");
 let control=Control::parse(&view(&l.e.c,"get_control_state",json!({"token_id":"k1"})).await,"k1").map_err(|e|anyhow::anyhow!(e.message))?;
 let owner=view(&l.e.c,"nft_token",json!({"token_id":"k1"})).await;
 guarded::private_access(&control,owner["owner_id"]==a.id().as_str()).map_err(|e|anyhow::anyhow!(e.message))?;
 anyhow::ensure!(l.store.set_if_absent(&format!("ui-auth/{}/{}",a.id(),B64.encode(nonce)),b"1").unwrap(),"replayed signature");
 Ok((a,signed.params,control))
}
async fn worker(l:&mut Layer<'_>,input:&Value)->Result<Value>{
 let op=input["op"].as_str().unwrap_or("");
 if op=="loan_certificate"{
  let loan=view(&l.e.c,"get_loan",json!({"token_id":"k1"})).await;
  anyhow::ensure!(input["params"]["token_id"]=="k1"&&input["params"]["loan_nonce"]==loan["nonce"]&&loan["state"]=="Offered","wrong public loan");
  let anchor=ui_final_block(l.e).await?;let ts=anchor.timestamp();let cert:Value=l.e.c.view("loan_certificate_template").args_json(json!({"token_id":"k1","observed_at_ns":ts.to_string(),"expires_at_ns":(ts+60_000_000_000).to_string()})).block_hash(*anchor.hash()).await?.json()?;
  let typed:guarded::Certificate=serde_json::from_value(cert.clone())?;
  guarded::frozen_policy(&typed,&view(&l.e.mock,"get_wallet_policy",json!({"wallet_pubkey":typed.wallet_pubkey})).await).map_err(|e|anyhow::anyhow!(e.message))?;
  anyhow::ensure!(l.balance>=typed.terms.floor_raw.parse::<u128>()?,"floor not met");
  let rows=l.rows.values().cloned().collect::<Vec<_>>();guarded::settled_inventory(&[json!({"requests":rows,"total":rows.len()})]).map_err(|e|anyhow::anyhow!(e.message))?;
  return Ok(json!({"output":{"ok":true,"certificate":cert,"signature":typed.sign(&[7;32]).map_err(|e|anyhow::anyhow!(e.message))?},"call_id":"sandbox-provider-mock","status":"success"}));
 }
 let (a,params,control)=private_auth(l,input,op).await?;let ms=ui_final_block(l.e).await?.timestamp()/1_000_000;
 let cooldown=keyhole_worker::ownership_sync::observe(&mut l.store,l.e.c.id().as_str(),"k1",a.id().as_str(),control.epoch,ms).map_err(|e|anyhow::anyhow!(e.message))?;
 if op=="pledge_inventory"{
  let rows=l.rows.values().cloned().collect::<Vec<_>>();let balances=json!({"balances":[{"token":guarded::ASSET,"amount":l.balance.to_string(),"symbol":"USDC","decimals":6},{"token":"nep141:unpriced.test.near","amount":"123","symbol":"UNPRICED"}]});
  let mut out=keyhole_worker::pledge_inventory::project(&balances,&[json!({"total":rows.len(),"requests":rows})],&json!({"items":[],"complete":true}),&json!({"approvals":[]})).map_err(|e|anyhow::anyhow!(e.message))?;
  out["ok"]=json!(true);out["account"]=json!(a.id());out["token_id"]=json!("k1");out["owner_epoch"]=json!(control.epoch.to_string());out["observed_at_ns"]=json!((ms*1_000_000).to_string());out["binding_ready"]=json!(true);out["limits"]=json!({"per_tx_usd_micro":1_000_000,"daily_usd_micro":5_000_000});out["spent_today_usd_micro"]=json!(2_000_000-l.balance);out["withdraw_cooldown_until_ms"]=json!(cooldown.filter(|end|*end>ms));
  return Ok(json!({"output":out,"call_id":"sandbox-provider-mock","status":"success"}));
 }
 anyhow::ensure!(op=="withdraw","unsupported fixture worker op");guarded::signed_epoch(&params,control.epoch).map_err(|e|anyhow::anyhow!(e.message))?;
 keyhole_worker::ownership_sync::require_elapsed(cooldown,ms).map_err(|e|anyhow::anyhow!(e.message))?;
 anyhow::ensure!(params["token"]==guarded::ASSET&&params["chain"]=="near"&&params["to"]==a.id().as_str(),"only supported self-exit allowed");
 let amount=params["amount"].as_str().unwrap_or("").parse::<u128>()?;anyhow::ensure!(amount>0&&amount<=1_000_000&&amount<=l.balance&&2_000_000-l.balance+amount<=5_000_000,"ordinary exit caps/balance exceeded");
 let mut j=l.journal(&a,"withdraw",&format!("ui-exit:{}",input["auth"]["signature"]));j.body["amount"]=json!(amount.to_string());j.create(l).map_err(|e|anyhow::anyhow!(e.message))?;
 guarded::confirm_admission(l,&j).map_err(|e|anyhow::anyhow!(e.message))?;guarded::drive_provider(l,&j,"sealed-mock-key",false).map_err(|e|anyhow::anyhow!(e.message))?;
 l.status(&j,"success",false);l.balance-=amount;
 let out=guarded::drive_provider(l,&j,"sealed-mock-key",true).map_err(|e|anyhow::anyhow!(e.message))?;
 Ok(json!({"output":out,"call_id":"sandbox-provider-mock","status":"success"}))
}
async fn handle(l:&mut Layer<'_>,path:&str,input:Value,counter:&mut u64)->Result<Value>{
 match path{
  "/metadata"=>Ok(json!({"contract":l.e.c.id(),"rpc":l.e.w.rpc_addr(),"borrower":l.e.alice.id(),"lender":l.e.lender.id(),"token_id":"k1","provider":"MOCK — not a live keystore or WASI attestation"})),
  "/sign"=>{let a=native_account(l.e,input["account_id"].as_str().unwrap_or(""))?;let op=input["op"].as_str().unwrap_or("");anyhow::ensure!(["pledge_inventory","withdraw","reconcile_value_op"].contains(&op),"unsupported signature intent");*counter+=1;sandbox_sign(&a,op,input["params"].clone(),*counter)},
  "/worker"=>worker(l,&input).await,
  "/advance"=>{let blocks=input["blocks"].as_u64().filter(|n|*n<=10000).ok_or_else(||anyhow::anyhow!("block range"))?;l.e.w.fast_forward(blocks).await?;Ok(json!({"now_ns":ui_final_block(l.e).await?.timestamp().to_string()}))},
  "/policy"=>{let refuse=input["refuse_thaw"].as_bool().ok_or_else(||anyhow::anyhow!("missing policy fixture flag"))?;l.e.mock.call("mock_refuse_thaw").args_json(json!({"refuse":refuse})).transact().await?.into_result()?;Ok(json!({"ok":true}))},
  "/tx"=>{
   let a=native_account(l.e,input["account_id"].as_str().unwrap_or(""))?;anyhow::ensure!(input["receiver_id"]==l.e.c.id().as_str(),"wrong receiver");
   let actions=input["actions"].as_array().filter(|v|!v.is_empty()&&v.len()<=2).ok_or_else(||anyhow::anyhow!("only atomic 1-2 action native batches allowed"))?;
   let mut batch=a.batch(l.e.c.id());let mut gas=0u64;let mut total=0u128;
   for action in actions{anyhow::ensure!(action["type"]=="FunctionCall","only FunctionCall");let p=&action["params"];let m=p["methodName"].as_str().unwrap_or("");anyhow::ensure!(["register_payout_account","open_loan","fund_loan","repay_loan","cancel_loan","claim_default","claim_payout","retry_loan_policy","reconcile_loan_policy"].contains(&m),"fixture method not allowed");let g=p["gas"].as_str().unwrap_or("").parse::<u64>()?;let d=p["deposit"].as_str().unwrap_or("").parse::<u128>()?;gas+=g;total+=d;
    batch=batch.call(Function::new(m).args_json(p["args"].clone()).deposit(NearToken::from_yoctonear(d)).gas(Gas::from_gas(g)));
   }
   anyhow::ensure!(gas<=300_000_000_000_000&&total<=N/10,"sandbox wallet spending ceiling exceeded");
   let result=batch.transact().await?;let hash=result.outcome().transaction_hash.to_string();let status=if result.is_success(){json!({"SuccessValue":""})}else{json!({"Failure":{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":format!("{:?}",result.into_result().unwrap_err())}}}}})};
   Ok(json!({"transaction":{"hash":hash,"signer_id":a.id(),"receiver_id":l.e.c.id()},"status":status}))
  },_=>anyhow::bail!("unknown isolated fixture route")
 }
}
#[tokio::test(flavor="multi_thread",worker_threads=4)]
#[ignore = "opt-in loopback UI harness; intentionally waits for real UI actions"]
async fn serve_ui_sandbox()->Result<()>{
 let e=ui_setup().await?;let mut l=Layer::new(&e);let mut counter=0u64;
 let metadata=handle(&mut l,"/metadata",json!({}),&mut counter).await?;
 let ready=std::env::var("UI_SANDBOX_READY").unwrap_or_else(|_|"/tmp/keyhole-ui-sandbox.json".into());std::fs::write(ready,serde_json::to_vec_pretty(&metadata)?)?;
 let listener=tokio::net::TcpListener::bind("127.0.0.1:3144").await?;println!("UI_SANDBOX_READY {metadata}");
 loop{
  let (mut stream,peer)=listener.accept().await?;if !peer.ip().is_loopback(){continue;}
  let mut bytes=Vec::new();let mut chunk=[0u8;4096];let request=async{loop{let n=stream.read(&mut chunk).await?;if n==0{anyhow::bail!("incomplete request");}bytes.extend_from_slice(&chunk[..n]);anyhow::ensure!(bytes.len()<=32768,"request bound");if let Some(end)=bytes.windows(4).position(|v|v==b"\r\n\r\n"){let h=std::str::from_utf8(&bytes[..end])?;let len=h.lines().find_map(|line|line.split_once(':').filter(|(k,_)|k.eq_ignore_ascii_case("content-length")).and_then(|(_,v)|v.trim().parse::<usize>().ok())).unwrap_or(0);anyhow::ensure!(len<=16384,"body bound");if bytes.len()>=end+4+len{let path=h.lines().next().and_then(|s|s.split_whitespace().nth(1)).unwrap_or("").to_string();let body=if len==0{json!({})}else{serde_json::from_slice(&bytes[end+4..end+4+len])?};return Ok::<_,anyhow::Error>((path,body));}}}};
  let result=match tokio::time::timeout(std::time::Duration::from_secs(10),request).await{Ok(Ok((p,b)))=>handle(&mut l,&p,b,&mut counter).await,Ok(Err(e))=>Err(e),Err(_)=>Err(anyhow::anyhow!("read timeout"))};
  let body=match result{Ok(v)=>v,Err(e)=>json!({"error":{"code":"sandbox_fixture","message":e.to_string()}})}.to_string();
  let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",body.len(),body);let _=stream.write_all(response.as_bytes()).await;
 }
}

#[tokio::test(flavor="multi_thread",worker_threads=2)]
async fn ui_bridge_authenticates_real_fullaccess_and_keeps_inventory_holder_only()->Result<()>{
 let e=ui_setup().await?;let mut l=Layer::new(&e);
 let auth=sandbox_sign(&e.alice,"pledge_inventory",json!({"token_id":"k1"}),1)?;
 let input=json!({"op":"pledge_inventory","auth":auth});let output=worker(&mut l,&input).await?;
 assert_eq!(output["output"]["complete"],true);assert_eq!(output["output"]["assets"].as_array().unwrap().len(),2);
 assert_eq!(output["output"]["account"],e.alice.id().as_str());assert!(worker(&mut l,&input).await.is_err(),"NEP-413 nonce cannot replay");
 let stranger=sandbox_sign(&e.lender,"pledge_inventory",json!({"token_id":"k1"}),2)?;
 assert!(worker(&mut l,&json!({"op":"pledge_inventory","auth":stranger})).await.is_err(),"public lender cannot read exact balances");
 assert_eq!(l.post_calls,0,"inventory/auth never dispatch custody value");Ok(())
}

#[tokio::test(flavor="multi_thread",worker_threads=2)]
async fn ui_bridge_certificate_uses_final_clock_and_exact_template()->Result<()>{
 let e=ui_setup().await?;register_payouts(&e.c,&e.alice,&[e.alice.id()]).await?;open(&e).await?;
 let mut l=Layer::new(&e);let request=json!({"op":"loan_certificate","params":{"token_id":"k1","loan_nonce":"1"}});
 let out=worker(&mut l,&request).await?;let cert=&out["output"]["certificate"];
 let final_block=ui_final_block(&e).await?;
 assert!(cert["observed_at_ns"].as_str().unwrap().parse::<u64>()?<=final_block.timestamp(),"a real browser checks the FINAL clock, never the optimistic head");
 let expected:Value=e.c.view("loan_certificate_template").args_json(json!({"token_id":"k1","observed_at_ns":cert["observed_at_ns"],"expires_at_ns":cert["expires_at_ns"]})).block_hash(*final_block.hash()).await?.json()?;
 assert_eq!(cert,&expected,"independently FINAL-read immutable loan binding");
 let typed:LoanCertificate=serde_json::from_value(cert.clone())?;
 let signature=ed25519_dalek::Signature::from_slice(&B64.decode(out["output"]["signature"].as_str().unwrap())?)?;
 SigningKey::from_bytes(&[7;32]).verifying_key().verify_strict(&near_sdk::borsh::to_vec(&typed)?,&signature)?;
 assert!(worker(&mut l,&json!({"op":"loan_certificate","params":{"token_id":"k1","loan_nonce":"2"}})).await.is_err(),"another nonce cannot borrow this certificate");
 l.balance=0;assert!(worker(&mut l,&request).await.is_err(),"public floor is still enforced");
 assert_eq!(l.post_calls,0,"public certification never dispatches provider value");Ok(())
}

#[tokio::test(flavor="multi_thread",worker_threads=2)]
async fn ui_bridge_transaction_reports_actual_native_signer()->Result<()>{
 let e=ui_setup().await?;let mut l=Layer::new(&e);let mut counter=0;
 let cost=view(&e.c,"payout_storage_cost",json!({})).await;
 let request=json!({"account_id":e.alice.id(),"receiver_id":e.c.id(),"actions":[{"type":"FunctionCall","params":{"methodName":"register_payout_account","args":{"account_id":e.alice.id()},"gas":"30000000000000","deposit":cost}}]});
 let out=handle(&mut l,"/tx",request.clone(),&mut counter).await?;
 assert_eq!(out["transaction"]["signer_id"],e.alice.id().as_str());assert_eq!(out["transaction"]["receiver_id"],e.c.id().as_str());
 assert!(out["transaction"]["hash"].as_str().unwrap().len()>30);assert!(out["status"].get("SuccessValue").is_some());
 assert_eq!(view(&e.c,"payout_account_registered",json!({"account_id":e.alice.id()})).await,true);
 assert_eq!(view(&e.c,"payout_account_registered",json!({"account_id":e.lender.id()})).await,false);
 let mut stranger=request;stranger["account_id"]=json!(e.bob.id());
 assert!(handle(&mut l,"/tx",stranger,&mut counter).await.is_err(),"bridge cannot sign for an arbitrary wallet");Ok(())
}