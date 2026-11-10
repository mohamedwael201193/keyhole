import base64,datetime,hashlib,json,pathlib,requests
from zoneinfo import ZoneInfo
D=pathlib.Path(__file__).parent
rpc='https://rpc.mainnet.fastnear.com'; account='keyhole-devmo.near'
def call(m,p):
 r=requests.post(rpc,json={'jsonrpc':'2.0','id':'read-only','method':m,'params':p},timeout=45);r.raise_for_status();j=r.json();assert 'result' in j,j;return j['result']
a=call('query',dict(request_type='view_account',account_id=account,finality='final'));b=a['block_hash'];out={'at':datetime.datetime.now(ZoneInfo('Africa/Cairo')).isoformat(),'rpc':rpc,'account':a,'views':[],'transactions':{}}
def q(kind,**kw):return call('query',dict(request_type=kind,account_id=account,block_id=b,**kw))
def view(m,args={}):
 r=q('call_function',method_name=m,args_base64=base64.b64encode(json.dumps(args).encode()).decode());v=json.loads(bytes(r['result']));out['views'].append({'method':m,'args':args,'result':v,'block_hash':r['block_hash']});return v
for m in ['contract_source_metadata','get_pledge_config','get_loan_limits','payout_storage_cost','nft_total_supply','config','nft_metadata']:view(m)
tokens=view('nft_tokens',{'from_index':'0','limit':100});view('nft_listings',{'from_index':'0','limit':100})
for t in tokens:
 for m in ['nft_token','get_control_state','pending_value_op_count','get_loan','get_collateral_binding','get_pending_registration','get_pending_transfer','get_lender_offer','get_sale']:view(m,{'token_id':t['token_id']})
 for m in ['get_pending_payout','get_principal_delivery','get_payout_credit','payout_account_registered']:view(m,{'account_id':t['owner_id']})
for kind in ['view_state','view_access_key_list']:
 out[kind]=q(kind,**({'prefix_base64':''} if kind=='view_state' else {}))
c=q('view_code');out['code']={'sha256':hashlib.sha256(base64.b64decode(c['code_base64'])).hexdigest(),'bytes':len(base64.b64decode(c['code_base64'])),'code_hash':c['hash']}
for label,h in [('deploy','BRuwESG8Baosp3txJWRdSHW1jXr9w4RgVURqZ2q2ou5S'),('migration','EwKUkWjuznyWJ1iPxuX1tU5Voe6tpfwxKRD1gB84FBaa')]:
 tx=call('tx',{'tx_hash':h,'sender_account_id':account,'wait_until':'FINAL'});assert tx['final_execution_status']=='FINAL';assert not any('Failure' in x['outcome']['status'] for x in tx['receipts_outcome'])
 signature=tx['transaction'].pop('signature')
 tx['transaction_signature_sha256']=hashlib.sha256(signature.encode()).hexdigest()
 tx['transaction_signature_note']='Public transaction signature omitted from this sanitized capture; transaction hash, FINAL status and receipt outcomes are unchanged.'
 out['transactions'][label]=tx
(D/'all-live-views.json').write_text(json.dumps(out,indent=2)+'\n');print('Recorded',len(out['views']),'views at',b,'and both FINAL receipt trees')
