# Gallery collisions and missing media

Investigation only. Nothing here changes how a token's traits are derived, and nothing here is deployed on-chain.

Read on 2026-10-28 from `nft_tokens` on `keyhole-devmo.near` (4 tokens) and from `web/lib/traits.ts`.

## B5. Why two keys share a picture

`keyIdentity` hashes `contract_id + token_id`, then copies **one whole row** from a catalog of ten pictures.

- Finish comes from the on-chain tier. Every key minted so far is tier 1, so the finish is Bronze.
- Bronze has three pictures: catalog 3, 5 and 8 (`POOLS.Bronze`).
- The picture is `pool[seed[0] % pool.length]`.
- Head, filigree, enamel, gem and shaft are the fields of that same row. They are not mixed from other bytes of the hash.

So two Bronze keys whose first seed byte falls in the same bucket of three are the same picture and the same five trait names. That is what the function does. It is not a bad hash and not a swapped id.

Checked with the current function, tier 1:

| Token | First seed byte | `byte % 3` | Picture |
|---|---|---|---|
| `0` | `0x02` | 2 | 8 Quatrefoil, Waves, Turquoise · Onyx |
| `k0642e7964b2fb515` | `0x71` | 2 | 8, same row |
| `k5f4750858f328940` | `0x2d` | 0 | 3 Trefoil, Lotus, Teal · Coral, Amber |
| `k857b6b68facc0f94` | `0x63` | 0 | 3, same row |

The bit cipher is separate (`bitCipherBits`) and does differ. The cards are not byte-for-byte identical. The picture and the named traits are.

With three Bronze pictures, a new Bronze key matches an existing one about one time in three. Silver has three pictures, Gold two, Legendary two. Adding rows to `POOLS` or `CATALOG` and keeping `seed[0] % pool.length` would move existing keys onto different pictures. That is a derivation change, and this note does not propose it.

### Smallest honest fix

Leave `keyIdentity` as it is for every token that already exists.

Say on the gallery, in one line, what is actually unique: the token id. The picture is one of three Bronze pictures. The five trait names are that picture's labels, not a second unique draw.

A larger set of pictures can apply to **later** mints only, behind a new function that the current ids never call. Existing ids keep today's row.

## B6. Why wallets show no image

The published worker `b3fa1a39` now writes `media` and `media_hash` on new mints. The four tokens that already exist still have `media: null`. The site draws those four from the same `sha256(contract id + token id)` formula. The rest of this section is the state before that deploy.

`nft_token` metadata on all four tokens has `media: null`. Titles are `KEYHOLE Key #0 (test)` for token `0` and `KEYHOLE Key · Bronze` for the other three.

The worker mint writes that metadata in `op_mint` (`tee/worker/src/main.rs`): title, description and `copies: 1`. It does not set `media` or `media_hash`. The contract stores the metadata it is given. `nft_metadata.base_uri` is `None`, and `new` is the only place that writes contract metadata. `beat` emits `nft_metadata_update` and does not write a media field. There is no method that updates a token's metadata.

The site already draws the picture from `keyIdentity` and serves the files at `/heirloom/keys/k01.webp` through `k10.webp`. Wallets never see that, because they read `media` from the token.

### Proposed fix

Do not deploy it in this change.

**New mints, no contract upgrade.** `TokenMetadata` already has `media` and `media_hash`. A worker change can set, for the picture `keyIdentity` already picks:

- `media`: `https://www.getkeyhole.xyz/heirloom/keys/kNN.webp` (absolute, so `base_uri` is unnecessary)
- `media_hash`: sha256 of that file, base64, as NEP-177 asks

Example, picture 8, the Quatrefoil file: sha256 `c24a6b280e49514b4f46bc46d049266939df1c5816d59bf8ebdc2564de1ec898`.

That worker change is a new wasm and a TEE redeploy. It does not change trait derivation. It is out of scope here.

**The four existing tokens need a contract upgrade.** Their `media: null` is already stored. Nothing in the current contract can replace it. The upgrade would be a minter-only setter for `media` and `media_hash`, plus the storage deposit for the extra bytes, then `beat` on those ids so indexers notice. Setting `base_uri` alone does not help while `media` is null.

### Cost

NEAR locks `10^19` yoctoNEAR per byte of storage, which is `0.00001` NEAR per byte. A media URL of about 56 characters and a 32-byte hash, stored where both fields are now `None`, is about 100 extra bytes. That is about **0.001 NEAR locked per token**. The unused part of the attached deposit is refunded.

`op_mint` already attaches `0.009` NEAR and `30` Tgas. The extra bytes are a storage cost, not a gas cost: they stay inside that 30 Tgas. If a measured mint is already close to `0.009` NEAR of locked storage, raise the attached deposit to `0.012` NEAR so the longer metadata cannot fail the mint. Gas for a later metadata-update call is a single storage write, also well under `30` Tgas. Backfilling four tokens is about `0.004` NEAR of extra lock, plus the one-time contract deploy.
