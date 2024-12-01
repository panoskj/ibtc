import { newAccountId, InterBtcApi, VaultExt, CurrencyExt } from '@interlay/interbtc-api';
import { BitcoinAmount } from '@interlay/monetary-js';
import { createInterBtcService } from './service';
import * as dotenv from 'dotenv';
dotenv.config();

let remainingQty = 0.25;
const maxQty = 0.03;
const intrPerBtc = 33400;
const refreshRemainingQtyTime = 2500;

async function runRemainingQty(interBTC: InterBtcApi, address: string) {
    const intrCurrency: CurrencyExt = interBTC.getGovernanceCurrency();
    const accountId = newAccountId(interBTC.api, address);

    while (true) {
        try {
            const { free: balance } = await interBTC.tokens.balance(intrCurrency, accountId);
            remainingQty = Math.trunc((10000 * Number(balance)) / intrPerBtc) / 10000;
        } catch (ex) {
            console.error('runRemainingQty failed');
            console.error(ex);
        }

        await new Promise(resolve => setTimeout(resolve, refreshRemainingQtyTime));
    }
}

async function runVault(interBTC: InterBtcApi, vault: VaultExt) {
    while (true) {
        let canIssue = false;
        try {
            if (!interBTC.account) return;
            if (vault.backingCollateral.isZero()) return;
            const issuable = await vault.getIssuableTokens();
            canIssue = true;
            const amount = Number(issuable.mul(10e8).toHuman()) / 10e8;
            if (amount <= 0.0005) continue;
            console.log(`The time is ${new Date()}`);
            console.log(`IssuableQty = ${amount}    -    RemainingQty = ${remainingQty})`);

            const max = new BitcoinAmount(Math.min(maxQty, remainingQty));
            const issue = issuable.min(max);
            const result = await interBTC.issue.request(issue);
            await result.extrinsic.signAndSend(interBTC.account, { tip: 1000000 });
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (ex) {
            if (canIssue) {
                console.error('runVault failed');
                console.error(ex);
            }
            if (!canIssue) await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }
}

async function runAllVaults(interBTC: InterBtcApi) {
    const startedVaultIds: string[] = [];

    const promises: Promise<void>[] = [];

    while (true) {
        try {
            const currentVaults = await interBTC.vaults.list();

            for (const vault of currentVaults) {
                if (vault.status != 0) continue; // Status 0 = Active, 1 = Inactive, 2 = Liquidated

                if (startedVaultIds.includes(vault.id)) continue;

                startedVaultIds.push(vault.id);

                promises.push(runVault(interBTC, vault));
            }
        } catch (error) {
            console.error('runAllVaults failed');
            console.error(error);
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

async function main() {
    if (!process.env.MNEMONIC) throw new Error('MNEMONIC must be specified in the .env file.');

    const service = await createInterBtcService();

    const address = await service.login(process.env.MNEMONIC);

    await Promise.all([runRemainingQty(service.interBTC, address), runAllVaults(service.interBTC)]);

    await service.disconnect();
}

main();
