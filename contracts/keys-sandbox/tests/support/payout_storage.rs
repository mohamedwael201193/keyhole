//! Explicit funded storage onboarding used by sandbox fixtures, never a mocked free slot.
use anyhow::Result;
use near_workspaces::{Account, Contract, types::{AccountId, NearToken}};
use serde_json::json;
pub async fn register_payouts(c: &Contract, sponsor: &Account, accounts: &[&AccountId]) -> Result<()> {
    let cost = c.view("payout_storage_cost").await?.json::<String>()?.parse::<u128>()?;
    for id in accounts {
        if c.view("payout_account_registered").args_json(json!({"account_id":id})).await?.json::<bool>()? { continue; }
        sponsor.call(c.id(),"register_payout_account").args_json(json!({"account_id":id}))
            .deposit(NearToken::from_yoctonear(cost)).max_gas().transact().await?.into_result()?;
    }
    Ok(())
}
