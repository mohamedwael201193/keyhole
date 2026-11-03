//! Chain Signatures helpers (pure, no host calls): per-key derivation path, local derivation of the
//! `v1.signer` child key (domain 0, secp256k1), EVM address, sign-request args and signature decoding.
use k256::elliptic_curve::sec1::{FromEncodedPoint, ToEncodedPoint};
use k256::elliptic_curve::PrimeField;
use k256::{AffinePoint, EncodedPoint, ProjectivePoint, Scalar};
use serde_json::{json, Value};
use sha3::{Digest, Keccak256, Sha3_256};

pub const SIGNER: &str = "v1.signer";
pub const DOMAIN_SECP256K1: u64 = 0;
/// Gas for `v1.signer.sign` (yield/resume needs headroom; unused gas is refunded).
pub const CHAINSIG_GAS: u64 = 100_000_000_000_000;
/// `v1.signer` domain 0 root key (mainnet view `public_key {"domain_id":0}`).
pub const ROOT_PK: &str = "secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya";
const EPSILON_PREFIX: &str = "near-mpc-recovery v0.1.0 epsilon derivation:";

/// One foreign address per key NFT: `keyhole/key/<token_id>`. Token ids are `k` + 16 hex.
pub fn path_for(token_id: &str) -> Option<String> {
    let ok = token_id.len() == 17 && token_id.starts_with('k') && token_id[1..].bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
    ok.then(|| format!("keyhole/key/{token_id}"))
}

pub fn epsilon(predecessor: &str, path: &str) -> Scalar {
    let h: [u8; 32] = Sha3_256::digest(format!("{EPSILON_PREFIX}{predecessor},{path}").as_bytes()).into();
    Option::from(Scalar::from_repr(h.into())).unwrap_or(Scalar::ZERO)
}

/// Parse `secp256k1:<base58 of 64-byte x||y>`.
pub fn parse_pk(s: &str) -> Option<AffinePoint> {
    let raw = bs58::decode(s.strip_prefix("secp256k1:")?).into_vec().ok()?;
    if raw.len() != 64 { return None; }
    let mut u = vec![4u8]; u.extend_from_slice(&raw);
    Option::from(AffinePoint::from_encoded_point(&EncodedPoint::from_bytes(&u).ok()?))
}

pub fn fmt_pk(p: &AffinePoint) -> String {
    format!("secp256k1:{}", bs58::encode(&p.to_encoded_point(false).as_bytes()[1..]).into_string())
}

/// child = root + epsilon·G (same rule as `v1.signer.derived_public_key`).
pub fn derive(root: &AffinePoint, predecessor: &str, path: &str) -> AffinePoint {
    (ProjectivePoint::GENERATOR * epsilon(predecessor, path) + ProjectivePoint::from(*root)).to_affine()
}

/// EIP-55 checksummed address of an uncompressed secp256k1 key.
pub fn evm_address(p: &AffinePoint) -> String {
    let h = Keccak256::digest(&p.to_encoded_point(false).as_bytes()[1..]);
    let lower = hex::encode(&h[12..]);
    let ch = Keccak256::digest(lower.as_bytes());
    let out: String = lower.chars().enumerate().map(|(i, c)| {
        let nib = (ch[i / 2] >> if i % 2 == 0 { 4 } else { 0 }) & 0xf;
        if c.is_ascii_alphabetic() && nib >= 8 { c.to_ascii_uppercase() } else { c }
    }).collect();
    format!("0x{out}")
}

/// Args for `v1.signer.sign`; payload must be a 32-byte hash (hex).
pub fn sign_args(payload_hex: &str, path: &str) -> Option<Value> {
    let p = payload_hex.strip_prefix("0x").unwrap_or(payload_hex);
    (p.len() == 64 && hex::decode(p).is_ok()).then(|| json!({"request": {
        "payload_v2": {"Ecdsa": p.to_ascii_lowercase()}, "path": path, "domain_id": DOMAIN_SECP256K1}}))
}

/// Decode the `sign` return value `{big_r:{affine_point}, s:{scalar}, recovery_id}` into r||s||v (65 bytes hex).
pub fn decode_sig(v: &Value) -> Option<String> {
    let big_r = hex::decode(v.pointer("/big_r/affine_point")?.as_str()?).ok()?;
    let s = hex::decode(v.pointer("/s/scalar")?.as_str()?).ok()?;
    let rid = v.get("recovery_id")?.as_u64().filter(|r| *r <= 1)?;
    if big_r.len() != 33 || !(big_r[0] == 2 || big_r[0] == 3) || s.len() != 32 { return None; }
    Some(format!("{}{}{:02x}", hex::encode(&big_r[1..]), hex::encode(&s), rid))
}

/// Check that r||s||v over `hash` recovers to `expect` (proof the MPC signed for this key's address).
pub fn recovers_to(hash: &[u8; 32], sig_hex: &str, expect: &AffinePoint) -> bool {
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
    let Ok(b) = hex::decode(sig_hex) else { return false };
    if b.len() != 65 { return false; }
    let (Ok(sig), Some(rid)) = (Signature::from_slice(&b[..64]), RecoveryId::from_byte(b[64])) else { return false };
    VerifyingKey::recover_from_prehash(hash, &sig, rid).map(|k| *k.as_affine() == *expect).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::SigningKey;
    const MINTER: &str = "015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443";
    fn root() -> AffinePoint { parse_pk(ROOT_PK).expect("root") }

    // Golden vectors read from mainnet `v1.signer.derived_public_key` (domain 0) on 2026-11-03.
    #[test] fn derive_matches_mainnet_minter_token_a() {
        assert_eq!(fmt_pk(&derive(&root(), MINTER, "keyhole/key/k5f4750858f328940")),
            "secp256k1:419SnrLvBuvGG69PxtC13uQGotdkjipAPFJr19goK2hbL9SQL3NsRmYp9cLHpuCMuhb2pebXgSQZXgBcpcppBvrx");
    }
    #[test] fn derive_matches_mainnet_minter_token_b() {
        assert_eq!(fmt_pk(&derive(&root(), MINTER, "keyhole/key/k0000000000000001")),
            "secp256k1:27kJ38Z3jQ7oENoWxa3N3j7AJZ6ZqfdGsQWirmWeG7ZNF9nubGydYVYYmwRXcewT41SvBi1BvUfPPiU8CaQGS8d4");
    }
    #[test] fn derive_matches_mainnet_named_account() {
        assert_eq!(fmt_pk(&derive(&root(), "keyhole-devmo.near", "keyhole")),
            "secp256k1:3ZdTLPEJ9R1mMtpdjY6dYJpuWNn26PkgBz3Q5cc1UEtcHqZYG9Y7pytJNvA44d3aXMMvXdzKpcahqdDB4fVPbLhT");
    }
    #[test] fn different_keys_get_different_addresses() {
        let a = derive(&root(), MINTER, &path_for("k5f4750858f328940").unwrap());
        let b = derive(&root(), MINTER, &path_for("k5f4750858f328941").unwrap());
        assert_ne!(evm_address(&a), evm_address(&b));
    }
    #[test] fn predecessor_is_part_of_the_derivation() {
        assert_ne!(derive(&root(), MINTER, "keyhole"), derive(&root(), "keyhole-devmo.near", "keyhole"));
    }
    #[test] fn pk_roundtrip_and_rejects() {
        assert_eq!(fmt_pk(&root()), ROOT_PK);
        assert!(parse_pk("ed25519:3tFRbMqmoa6AAALM").is_none());
        assert!(parse_pk("secp256k1:111").is_none());
        let mut bad = bs58::decode(&ROOT_PK[10..]).into_vec().unwrap(); bad[63] ^= 1; // off the curve
        assert!(parse_pk(&format!("secp256k1:{}", bs58::encode(bad).into_string())).is_none());
    }
    #[test] fn path_only_for_wellformed_token_ids() {
        assert_eq!(path_for("k5f4750858f328940").as_deref(), Some("keyhole/key/k5f4750858f328940"));
        for bad in ["", "k5f47", "x5f4750858f328940", "k5F4750858f328940", "k5f4750858f32894g", "k5f4750858f328940/x"] {
            assert!(path_for(bad).is_none(), "{bad}");
        }
    }
    #[test] fn evm_address_known_vector_privkey_one() {
        let sk = SigningKey::from_slice(&{ let mut k = [0u8; 32]; k[31] = 1; k }).unwrap();
        assert_eq!(evm_address(sk.verifying_key().as_affine()), "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
    }
    #[test] fn sign_args_shape_and_validation() {
        let h = "AB".repeat(32);
        assert_eq!(sign_args(&format!("0x{h}"), "keyhole/key/k5f4750858f328940").unwrap(),
            json!({"request": {"payload_v2": {"Ecdsa": "ab".repeat(32)}, "path": "keyhole/key/k5f4750858f328940", "domain_id": 0}}));
        assert!(sign_args(&"ab".repeat(31), "p").is_none());
        assert!(sign_args(&"zz".repeat(32), "p").is_none());
    }
    fn mpc_shape(sk: &SigningKey, hash: &[u8; 32]) -> Value {
        let (sig, rid) = sk.sign_prehash_recoverable(hash).unwrap();
        let r = sig.r().to_bytes();
        let big_r = format!("{:02x}{}", 2 + (rid.to_byte() & 1), hex::encode(r));
        json!({"big_r": {"affine_point": big_r}, "s": {"scalar": hex::encode(sig.s().to_bytes())}, "recovery_id": rid.to_byte()})
    }
    #[test] fn decoded_mpc_signature_recovers_signer() {
        let sk = SigningKey::from_slice(&[7u8; 32]).unwrap();
        let hash: [u8; 32] = Keccak256::digest(b"keyhole chain-sig test").into();
        let sig = decode_sig(&mpc_shape(&sk, &hash)).unwrap();
        assert_eq!(sig.len(), 130);
        assert!(recovers_to(&hash, &sig, sk.verifying_key().as_affine()));
    }
    #[test] fn recovery_fails_closed() {
        let sk = SigningKey::from_slice(&[7u8; 32]).unwrap();
        let other = SigningKey::from_slice(&[8u8; 32]).unwrap();
        let hash: [u8; 32] = Keccak256::digest(b"m").into();
        let sig = decode_sig(&mpc_shape(&sk, &hash)).unwrap();
        assert!(!recovers_to(&hash, &sig, other.verifying_key().as_affine()), "wrong key");
        let mut h2 = hash; h2[0] ^= 1;
        assert!(!recovers_to(&h2, &sig, sk.verifying_key().as_affine()), "wrong hash");
        assert!(!recovers_to(&hash, &sig[..128], sk.verifying_key().as_affine()), "short");
    }
    #[test] fn decode_sig_rejects_malformed() {
        let sk = SigningKey::from_slice(&[7u8; 32]).unwrap();
        let good = mpc_shape(&sk, &[1u8; 32]);
        let mut v = good.clone(); v["recovery_id"] = json!(2); assert!(decode_sig(&v).is_none());
        let mut v = good.clone(); v["big_r"]["affine_point"] = json!(format!("04{}", &good["big_r"]["affine_point"].as_str().unwrap()[2..])); assert!(decode_sig(&v).is_none());
        let mut v = good.clone(); v["s"]["scalar"] = json!("00"); assert!(decode_sig(&v).is_none());
        let mut v = good; v.as_object_mut().unwrap().remove("s"); assert!(decode_sig(&v).is_none());
    }
}
