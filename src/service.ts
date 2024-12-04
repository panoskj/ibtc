import {
    createInterBtcApi,
    CurrencyExt,
    ExtrinsicData,
    InterBtcApi,
    newAccountId,
    VaultExt,
} from '@interlay/interbtc-api';

import { BitcoinAmount, Interlay } from '@interlay/monetary-js';
import { Keyring } from '@polkadot/keyring';

export async function createInterBtcService() {
    // If you are using a local development environment
    // const PARACHAIN_ENDPOINT = "ws://127.0.0.1:9944";
    // if you want to use the Interlay-hosted beta network
    const PARACHAIN_ENDPOINT = 'wss://api.interlay.io/parachain';
    const bitcoinNetwork = 'mainnet';
    const interBTC = await createInterBtcApi(PARACHAIN_ENDPOINT, bitcoinNetwork);
    return new InterBtcService(interBTC);
}

function getDateTime() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

export class InterBtcService {
    interBTC: InterBtcApi;
    remainingQty?: number;
    intrPerBtc: number;
    address?: string;
    currentMaxTip: number;

    constructor(interBTC: InterBtcApi) {
        this.interBTC = interBTC;
        this.intrPerBtc = 33400;
        this.currentMaxTip = 0;
    }

    async login(mnemonic: string) {
        // Initialize the Keyring
        const keyring = new Keyring({ type: 'sr25519', ss58Format: 2032 });

        const account = keyring.addFromMnemonic(mnemonic);

        this.interBTC.setAccount(account);

        console.log(`Account = ${account.address}`);

        this.address = account.address;
    }

    async disconnect() {
        await this.interBTC.disconnect();
    }

    async getCurrentMaxTip(excludingAddress?: string) {
        const pendingExtrinsics = await this.interBTC.api.rpc.author.pendingExtrinsics();

        const tips = pendingExtrinsics
            .filter(extrinsic => extrinsic.signer.toString() != excludingAddress)
            .map(extrinsic => Number(extrinsic.tip));

        return Math.max(0, ...tips);
    }

    requireAddress() {
        if (this.address) return this.address;
        throw new Error('You have to login for this function.');
    }

    async inspectTx(blockHash: string, transactionHash: string) {
        const block = await this.interBTC.api.rpc.chain.getBlock(blockHash);

        // Find the transaction in the block's extrinsics
        const extrinsics = block.block.extrinsics;
        const extrinsic = extrinsics.find(ext => ext.hash.toHex() == transactionHash);

        if (!extrinsic) throw new Error('TX not found');

        console.log('Pending extrinsic:', extrinsic.toHuman());
        const {
            method: { method },
            tip,
        } = extrinsic;
        console.log(`Method ${method}, tip ${tip}`);

        return { method, tip };
    }

    async getMempoolTransaction(interBTC: InterBtcApi) {
        while (true) {
            try {
                const pendingExtrinsics = await interBTC.api.rpc.author.pendingExtrinsics();

                pendingExtrinsics.forEach(extrinsic => {
                    console.log('Pending extrinsic:', extrinsic.toHuman());
                    const {
                        method: { method },
                        tip,
                    } = extrinsic;
                    console.log(`Method ${method}, tip ${tip}`);
                });

                if (pendingExtrinsics.length > 0) return pendingExtrinsics;
            } catch (error) {
                console.error(error);
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    async runRemainingQty(frequencyMilliseconds: number) {
        const intrCurrency: CurrencyExt = this.interBTC.getGovernanceCurrency();
        const accountId = newAccountId(this.interBTC.api, this.requireAddress());

        while (true) {
            try {
                const { free: balance } = await this.interBTC.tokens.balance(intrCurrency, accountId);
                this.remainingQty = Math.trunc((10000 * Number(balance)) / this.intrPerBtc) / 10000;
            } catch (ex) {
                console.error('runRemainingQty failed');
                console.error(ex);
            }

            await new Promise(resolve => setTimeout(resolve, frequencyMilliseconds));
        }
    }

    async runMaxTip(frequencyMilliseconds: number) {
        const address = this.requireAddress();
        while (true) {
            try {
                this.currentMaxTip = await this.getCurrentMaxTip(address);
            } catch (ex) {
                this.currentMaxTip = 0;
                console.error('runMaxTip failed');
                console.error(ex);
            }
            await new Promise(resolve => setTimeout(resolve, frequencyMilliseconds));
        }
    }

    async signAndSend(tx: ExtrinsicData & { extrinsic: unknown }, maxDelay: number, tip?: number) {
        await new Promise<void>(resolve => {
            let resolved = false;
            function resolveOnce() {
                if (resolved) return;
                resolved = true;
                resolve();
            }

            setTimeout(resolveOnce, maxDelay);

            const signAndSend = async () => {
                try {
                    if (!this.interBTC.account) throw new Error('You must login to send transactions');
                    await tx.extrinsic.signAndSend(this.interBTC.account, { tip: tip }, status => {
                        console.log('TX Update:');
                        console.log(JSON.stringify(status.toHuman(), null, 4));
                        if (
                            status.status.isBroadcast ||
                            status.status.isDropped ||
                            status.status.isRetracted ||
                            status.status.isInvalid ||
                            status.status.isFinalityTimeout
                        ) {
                            resolveOnce();
                        }
                    });
                } catch (error) {
                    console.error('signAndSend failed');
                    console.error(error);
                }
            };

            signAndSend();
        });
    }

    async runVault(vault: VaultExt, maxQty: number) {
        console.log(`running vault: ${vault.id.accountId}`);
        while (true) {
            let canIssue = false;
            try {
                if (!this.interBTC.account) return;
                if (vault.backingCollateral.isZero()) return;
                const issuable = await vault.getIssuableTokens();
                canIssue = true;
                const amount = Number(issuable.mul(10e8).toHuman()) / 10e8;
                if (amount <= 0.0005) continue;
                const myTip = this.currentMaxTip + 1000000;

                console.log(
                    `[${vault.id.accountId}] IssuableQty = ${amount}    -    RemainingQty = ${this.remainingQty}     ---     TIP: ${myTip} VS ${this.currentMaxTip})`,
                );

                const max = new BitcoinAmount(Math.min(maxQty, this.remainingQty ?? maxQty));
                const issue = issuable.min(max);
                const result = this.interBTC.issue.buildRequestIssueExtrinsic(vault.id, issue, Interlay);

                await Promise.all([
                    this.signAndSend({ extrinsic: result }, 1000, myTip),
                    new Promise<void>(resolve => setTimeout(resolve, 100)),
                ]);
            } catch (ex) {
                if (canIssue) {
                    console.error('runVault failed');
                    console.error(ex);
                }
                if (!canIssue) await new Promise(resolve => setTimeout(resolve, 30000));
            }
        }
    }

    async runAllVaults(maxQty: number) {
        const startedVaultIds: string[] = [];

        const promises: Promise<void>[] = [];

        while (true) {
            try {
                const currentVaults = await this.getActiveVaults();

                for (const vault of currentVaults) {
                    if (startedVaultIds.includes(`${vault.id.accountId}`)) continue;

                    startedVaultIds.push(`${vault.id.accountId}`);

                    promises.push(this.runVault(vault, maxQty));
                }
            } catch (error) {
                console.error('runAllVaults failed');
                console.error(error);
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    async getActiveVaults() {
        const allVaults = await this.interBTC.vaults.list();
        // Status 0 = Active, 1 = Inactive, 2 = Liquidated
        return allVaults.filter(vault => vault.status == 0 && Number(vault.backingCollateral.toHuman()) > 1);
    }
}
