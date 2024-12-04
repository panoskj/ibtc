import { createInterBtcApi, CurrencyExt, InterBtcApi, newAccountId, VaultExt } from '@interlay/interbtc-api';
import { BitcoinAmount, Interlay } from '@interlay/monetary-js';
import { Keyring } from '@polkadot/keyring';
import { ExtrinsicData } from '@interlay/interbtc-api';
import { MultipleProducersSingleConsumerChannel } from './channel';

async function delayAsync(milliseconds: number) {
    await new Promise(resolve => setTimeout(resolve, milliseconds));
}

type SubmittableExtrinsic = ExtrinsicData['extrinsic'];

export async function createInterBtcService() {
    // If you are using a local development environment
    // const PARACHAIN_ENDPOINT = "ws://127.0.0.1:9944";
    // if you want to use the Interlay-hosted beta network
    const PARACHAIN_ENDPOINT = 'wss://api.interlay.io/parachain';
    const bitcoinNetwork = 'mainnet';
    const interBTC = await createInterBtcApi(PARACHAIN_ENDPOINT, bitcoinNetwork);
    return new InterBtcService(interBTC);
}

export class InterBtcService {
    interBTC: InterBtcApi;
    remainingQty?: number;
    intrPerBtc: number;
    address?: string;
    currentMaxTip: number;
    currentTipSum: number;
    vaults: Record<string, { vault: VaultExt; currentMaxIssuable?: number }>;
    runningRequest?: { totalIssueAmount: number; tip: number };
    fullspeedMode: boolean;
    currentTipIncrements: number;

    constructor(interBTC: InterBtcApi) {
        this.interBTC = interBTC;
        this.intrPerBtc = 33400;
        this.currentMaxTip = 0;
        this.currentTipSum = 0;
        this.vaults = {};
        this.fullspeedMode = false;
        this.currentTipIncrements = 0;
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

        return { maxTip: Math.max(0, ...tips), sumTip: [0, ...tips].reduce((a, b) => a + b) };
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

            await delayAsync(1000);
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

            await delayAsync(frequencyMilliseconds);
        }
    }

    async runMaxTip(frequencyMilliseconds: number) {
        const address = this.requireAddress();
        while (true) {
            const prevTip = this.currentMaxTip;
            try {
                const { maxTip, sumTip } = await this.getCurrentMaxTip(address);
                this.currentMaxTip = maxTip;
                this.currentTipSum = sumTip;
            } catch (ex) {
                this.currentMaxTip = 0;
                this.currentTipSum = 0;
                console.error('runMaxTip failed');
                console.error(ex);
            }
            if (prevTip < this.currentMaxTip) this.currentTipIncrements += 1;
            else if (this.currentMaxTip == 0) this.currentTipIncrements = 0;
            if (!this.fullspeedMode) await delayAsync(frequencyMilliseconds);
        }
    }

    async signAndSend(
        extrinsic: SubmittableExtrinsic,
        minDelay: number,
        maxDelay: number,
        tip?: number,
        name?: string,
    ) {
        const job = new Promise<void>(resolve => {
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
                    await extrinsic.signAndSend(this.interBTC.account, { tip: tip }, status => {
                        //console.log(`TX Update: ${name}`);
                        //console.log(JSON.stringify(status.toHuman(), null, 4));
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

            console.log(`Sign And Send ${name}`);
            signAndSend();
        });
        const minDelayPromise = delayAsync(minDelay);
        await Promise.all([job, minDelayPromise]);
    }

    /**
     * Pass null in extrinsicsChannel to terminate
     * @param extrinsicsChannel
     * @param baseTip
     * @param additionalTipPerSecond
     * @returns
     */
    async optimizedSignAndSend(
        extrinsicsChannel: MultipleProducersSingleConsumerChannel<SubmittableExtrinsic | null>,
        baseTip?: number,
        additionalTipPerSecond?: number,
        runsPerSecond?: number,
        name?: string,
    ) {
        let additionalTip = 0;
        let extrinsicToSend: SubmittableExtrinsic | null = null;
        let batchPromise: Promise<(SubmittableExtrinsic | null)[]> | null = null;
        function consumeBatch() {
            async function consumeBatchAsync() {
                const result = await extrinsicsChannel.consumeBatch();
                batchPromise = null;
                return result;
            }
            return (batchPromise ??= consumeBatchAsync());
        }
        while (true) {
            if (!extrinsicToSend) {
                const batch = await consumeBatch();
                extrinsicToSend = batch[batch.length - 1];
            } else {
                const delayPromise = delayAsync(Math.trunc(1000 / (runsPerSecond ?? 20)));
                const result = await Promise.any([delayPromise, consumeBatch()]);
                if (result) {
                    extrinsicToSend = result[result.length - 1];
                }
            }
            if (!extrinsicToSend) return;
            const tip = (baseTip ?? 1) + this.currentMaxTip + additionalTip;
            await this.signAndSend(extrinsicToSend, 0, 0, tip, `${name} - tip: ${tip} vs ${this.currentMaxTip}`);
            additionalTip += Math.trunc((additionalTipPerSecond ?? 200000000) / (runsPerSecond ?? 20));
        }
    }

    async batchSignAndSend(extrinsics: SubmittableExtrinsic[], minDelay: number, maxDelay: number, tip?: number) {
        const extrinsic = this.interBTC.transaction.buildBatchExtrinsic(extrinsics, false);
        await this.signAndSend(extrinsic, minDelay, maxDelay, tip);
    }

    async executeBatchIssueRequest(maxQty: number, minDelay: number, maxDelay: number) {
        let extrinsicFactory: (() => SubmittableExtrinsic) | null = null;
        let remainingQty = this.remainingQty ?? maxQty;
        let totalIssueAmount = 0;
        let maxAmount = 0;

        console.log('Creating Batch TX');

        for (const vaultId in this.vaults) {
            const { vault, currentMaxIssuable } = this.vaults[vaultId];
            if ((currentMaxIssuable ?? 0) <= 0.0005) continue;

            const issue = Math.min(maxQty, remainingQty, currentMaxIssuable!);
            remainingQty -= issue;

            totalIssueAmount += issue;
            console.log(`Vault = ${vault.id.accountId} Request = ${issue}`);

            if (issue < maxAmount) continue;
            maxAmount = issue;
            extrinsicFactory = () =>
                this.interBTC.issue.buildRequestIssueExtrinsic(vault.id, new BitcoinAmount(issue), Interlay);
        }

        // use `totalIssueAmount` here to prioritize larger transactions (only one tx per address can be included in a block)
        const tip = this.currentTipSum + Math.trunc((1 + totalIssueAmount + this.currentTipIncrements / 5) * 1000000);

        // tx must have a greater tip than the currently running tx in order to succeed
        if (tip <= (this.runningRequest?.tip ?? 0) || !extrinsicFactory) return;

        console.log(`Running Batch TX - Tip = ${tip} Versus ${this.currentMaxTip}`);

        try {
            this.runningRequest = { totalIssueAmount, tip };
            await this.signAndSend(extrinsicFactory(), minDelay, maxDelay, tip);
        } finally {
            delete this.runningRequest;
        }
    }

    async runVault(vault: VaultExt, maxQty: number) {
        console.log(`running vault: ${vault.id.accountId}`);
        this.vaults[`${vault.id.accountId}`] = { vault };
        while (true) {
            let canIssue = false;
            try {
                if (!this.interBTC.account) break;
                if (vault.backingCollateral.isZero()) break;
                const issuable = await vault.getIssuableTokens();
                canIssue = true;
                const amount = Number(issuable.mul(10e8).toHuman()) / 10e8;
                this.vaults[`${vault.id.accountId}`].currentMaxIssuable = amount;
                this.fullspeedMode = Object.values(this.vaults).some(x => (x.currentMaxIssuable ?? 0) > 0.0005);
                if (amount <= 0.0005) continue;
                await this.executeBatchIssueRequest(maxQty, this.fullspeedMode ? 5 : 100, 1000);
            } catch (ex) {
                if (canIssue) {
                    console.error('runVault failed');
                    console.error(ex);
                }
                if (!canIssue) await delayAsync(30000);
            }
        }
        delete this.vaults[`${vault.id.accountId}`];
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

            await delayAsync(3000);
        }
    }

    async getActiveVaults() {
        const allVaults = await this.interBTC.vaults.list();
        // Status 0 = Active, 1 = Inactive, 2 = Liquidated
        return allVaults.filter(vault => vault.status == 0 && Number(vault.backingCollateral.toHuman()) > 1);
    }
}
