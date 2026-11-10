export type IntentIdentity={id?:string;owner?:string};
export type IntentStore<T extends IntentIdentity>={
 load():T|null;
 reserve(value:T):Promise<T>;
 replace(expected:T,value:T):Promise<boolean>;
 clear(expected:T):Promise<boolean>;
 clearVerified(expected:T,verify:(snapshot:T)=>Promise<boolean>):Promise<boolean>;
 subscribe(listener:()=>void):()=>void;
};
export type IntentAdmission<T>={scope:string;check:(value:T)=>void};
export const pledgeLifecycleScope=(account:string,contract:string)=>`keyhole:pledge-lifecycle:v1:${contract}:${account}`;
export type IntentEnvironment={
 storage:Storage;session:Pick<Storage,"getItem"|"setItem">;
 locks:{request<T>(name:string,callback:()=>T|Promise<T>):Promise<T>}|undefined;
 uuid:()=>string;listen:(listener:()=>void)=>()=>void;changed:()=>void;
};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Per-intent records plus browser-wide admission serialization. No racy localStorage lock fallback. */
export function createBrowserIntentStore<T extends IntentIdentity>(scope:string,validate:(value:T)=>void,env:IntentEnvironment,admission?:IntentAdmission<T>):IntentStore<T> {
 const prefix=scope+":intent:",ownerKey="keyhole:pledge-tab:v2";
 let owner=env.session.getItem(ownerKey);
 if(!owner){owner=env.uuid();env.session.setItem(ownerKey,owner);}
 const ownerId=owner;
 const read=(key:string):T|null=>{const raw=env.storage.getItem(key);if(!raw)return null;if(raw.length>32768)throw Error("Pending operation storage is invalid");const value=JSON.parse(raw) as T;validate(value);return value;};
 const keys=()=>{const result:string[]=[];for(let i=0;i<env.storage.length;i++){const key=env.storage.key(i);if(key?.startsWith(prefix))result.push(key);}return result.sort();};
 const load=()=>{const legacy=read(scope);if(legacy)return legacy;for(const key of keys()){const value=read(key);if(value)return value;}return null;};
 const exclusive=<R,>(job:()=>R|Promise<R>):Promise<R>=>{
  if(!env.locks)return Promise.reject(Error("Cross-tab Web Locks unavailable. Money actions are disabled; use a supported secure browser."));
  return env.locks.request((admission?.scope??scope)+":admission",job);
 };
 const keyOf=(value:T)=>value.id?prefix+value.id:scope;
 const owned=(value:T)=>!value.owner||value.owner===ownerId; // legacy records have no owner; exact-record recovery only
 const matches=(expected:T)=>{const current=read(keyOf(expected));return !!current&&owned(current)&&same(current,expected);};
 return {
  load,
  reserve:value=>exclusive(()=>{
   admission?.check(value);
   if(load())throw Error("An earlier money operation is unresolved. Refresh its original receipt; do not resend.");
   const next={...value,id:env.uuid(),owner:ownerId};validate(next);env.storage.setItem(keyOf(next),JSON.stringify(next));env.changed();return next;
  }),
  replace:(expected,value)=>exclusive(()=>{
   if(!matches(expected))return false;
   if(expected.id&&(value.id!==expected.id||value.owner!==expected.owner))throw Error("Intent identity cannot change");
   const next=expected.id?value:{...value,id:env.uuid(),owner:ownerId};validate(next);
   env.storage.setItem(keyOf(next),JSON.stringify(next));
   if(!expected.id)Object.assign(value,next); // return the newly adopted legacy identity to this continuation
   if(!expected.id&&same(read(scope),expected))env.storage.removeItem(scope);
   env.changed();return true;
  }),
  clear:expected=>exclusive(()=>{if(!matches(expected))return false;env.storage.removeItem(keyOf(expected));env.changed();return true;}),
  clearVerified:async(expected,verify)=>{
   // No owner-session guessing or long-held lock: verify first, then exact-record CAS under admission lock.
   const encoded=JSON.stringify(expected),snapshot=JSON.parse(encoded) as T,key=keyOf(snapshot);validate(snapshot);
   if(!await verify(JSON.parse(encoded) as T))return false;
   return exclusive(()=>{const current=read(key);if(!current||JSON.stringify(current)!==encoded)return false;
    env.storage.removeItem(key);env.changed();return true;
   });
  },
  subscribe:env.listen,
 };
}
export function browserIntentEnvironment():IntentEnvironment {
 return {storage:localStorage,session:sessionStorage,locks:navigator.locks,uuid:()=>crypto.randomUUID(),
 listen:listener=>{window.addEventListener("storage",listener);window.addEventListener("keyhole:money-changed",listener);return ()=>{window.removeEventListener("storage",listener);window.removeEventListener("keyhole:money-changed",listener);};},
 changed:()=>window.dispatchEvent(new Event("keyhole:money-changed"))};
}
