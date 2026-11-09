// LOCAL TEST RECEIVER ONLY. Delays settlement using protocol yields, never production.
use near_sdk::{env,Gas,GasWeight};
fn hold(){
 let gas=env::prepaid_gas().saturating_sub(env::used_gas()).saturating_sub(Gas::from_tgas(5));
 let promise=env::promise_yield_create("after_yield",b"{}",gas,GasWeight(0),0);
 env::storage_write(b"yield_id",&env::read_register(0).unwrap());
 env::promise_return(promise);
}
#[no_mangle]pub extern "C" fn nft_on_transfer(){hold();}
#[no_mangle]pub extern "C" fn after_yield(){
 if env::storage_has_key(b"accepted"){env::value_return(b"false");}else{hold();}
}
#[no_mangle]pub extern "C" fn accept(){
 env::storage_write(b"accepted",&[1]);
 let id:[u8;32]=env::storage_read(b"yield_id").unwrap().try_into().unwrap();
 let resumed=env::promise_yield_resume(&id,b"false");
 env::value_return(if resumed{b"true"}else{b"false"});
}

// Test-only sender/observer: store the actual final NEP-171 promise boolean.
// Avoid transaction-status RPC polling of an intentionally unresolved yield chain.
fn input()->near_sdk::serde_json::Value {near_sdk::serde_json::from_slice(&env::input().unwrap()).unwrap()}
#[no_mangle] pub extern "C" fn start(){
 let a=input(); let keys:near_sdk::AccountId=a["keys"].as_str().unwrap().parse().unwrap();
 let receiver=a["receiver"].as_str().unwrap(); let label=a["label"].as_str().unwrap();
 let args=near_sdk::serde_json::json!({"token_id":"k1","receiver_id":receiver,"msg":""}).to_string().into_bytes();
 let _=near_sdk::Promise::new(keys).function_call("nft_transfer_call".into(),args,near_sdk::NearToken::from_yoctonear(1),Gas::from_tgas(220))
 .then(near_sdk::Promise::new(env::current_account_id()).function_call("record_result".into(),near_sdk::serde_json::json!({"label":label}).to_string().into_bytes(),near_sdk::NearToken::from_yoctonear(0),Gas::from_tgas(10)));
}
#[no_mangle] pub extern "C" fn record_result(){
 assert_eq!(env::predecessor_account_id(),env::current_account_id());
 let a=input(); let key=format!("result/{}",a["label"].as_str().unwrap());
 let result=match env::promise_result(0){near_sdk::PromiseResult::Successful(v)=>v,_=>b"null".to_vec()};
 env::storage_write(key.as_bytes(),&result);
}
#[no_mangle] pub extern "C" fn get_result(){
 let a=input();let key=format!("result/{}",a["label"].as_str().unwrap());
 env::value_return(&env::storage_read(key.as_bytes()).unwrap_or_else(||b"null".to_vec()));
}
