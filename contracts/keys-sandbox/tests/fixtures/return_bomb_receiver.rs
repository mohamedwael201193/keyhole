// AUDITOR TEST FIXTURE ONLY: adversarial NEP-171 receiver return-data bomb.
#[no_mangle]
pub extern "C" fn nft_on_transfer() {
 let mut bytes=vec![b' '; 2_000_000]; bytes.extend_from_slice(b"true");
 near_sdk::env::value_return(&bytes);
}
