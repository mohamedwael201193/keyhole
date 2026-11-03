//! P2 golden vectors: token_id_for(account) = "k" + first 16 hex of sha256(account), computed independently (Python hashlib).
use super::*;
macro_rules! tid_rows { ($($name:ident: $a:expr => $want:expr;)*) => { $(#[test] fn $name() { assert_eq!(token_id_for($a), $want); })* } }
tid_rows! {
    tid_0: "keyhole-devmo.near" => "keea9b6daf1feaff5";
    tid_1: "a.near" => "kbb7cc7b0e25a23d2";
    tid_2: "alice.near" => "k2dd5dda540767b3a";
    tid_3: "bob.testnet" => "kfd7fcba4e46fc866";
    tid_4: "0xf76e6b0920e9332ff4410f6dd53f01722abc71a3" => "k102a806df6867547";
    tid_5: "3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447" => "k5f4750858f328940";
    tid_6: "a7458a83e9c4693286692efab949fc0f7d089b7f46352fb2a87a514ec2c391da" => "k857b6b68facc0f94";
    tid_7: "476abdb54d0a55fba7cf45c624aa5a65665aaa92f50f4dd36f09abc1890ca8c8" => "k0642e7964b2fb515";
    tid_8: "0705fdc1581a35351453bd4625f22d0c41b2b9edc3e7bed860586623c6778228" => "k7df5b0263400959e";
    tid_9: "sub.keyhole-devmo.near" => "kfc722e214970aa51";
    tid_10: "x_y-z.near" => "ka7b0b57f9773f212";
    tid_11: "near" => "k46ba34770bccfde7";
    tid_12: "aa" => "k961b6dd3ede3cb8e";
    tid_13: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" => "kffe054fe7ae0cb6d";
    tid_14: "0x0000000000000000000000000000000000000000" => "k0fff9ee671b05ea2";
    tid_15: "user.tg" => "k76c6f53a01a10fa1";
    tid_16: "relay.aurora" => "k4ebd4a7265385322";
    tid_17: "v1.signer" => "k713d69942d1f287f";
    tid_18: "outlayer.near" => "kb7da09ca7fb1d601";
    tid_19: "intents.near" => "ka70692c20f12a0bd";
}
#[test] fn live_token_ids_match_their_owners() {
    // Mainnet keys minted by the enclave (read 2026-11-03).
    for (owner, id) in [("3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447", "k5f4750858f328940"), ("a7458a83e9c4693286692efab949fc0f7d089b7f46352fb2a87a514ec2c391da", "k857b6b68facc0f94"), ("476abdb54d0a55fba7cf45c624aa5a65665aaa92f50f4dd36f09abc1890ca8c8", "k0642e7964b2fb515"), ("0xf76e6b0920e9332ff4410f6dd53f01722abc71a3", "k102a806df6867547")] {
        assert_eq!(token_id_for(owner), id, "{owner}");
    }
}
