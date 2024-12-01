import { createInterBtcApi, InterBtcApi } from '@interlay/interbtc-api';
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

export class InterBtcService {
    interBTC: InterBtcApi;

    constructor(interBTC: InterBtcApi) {
        this.interBTC = interBTC;
    }

    async login(mnemonic: string) {
        // Initialize the Keyring
        const keyring = new Keyring({ type: 'sr25519', ss58Format: 2032 });

        const account = keyring.addFromMnemonic(mnemonic);

        this.interBTC.setAccount(account);

        console.log(`Account = ${account.address}`);

        return account.address;
    }

    async disconnect() {
        await this.interBTC.disconnect();
    }

    async getCurrentMaxTip(excludingAddress?: string) {
        const pendingExtrinsics = await this.interBTC.api.rpc.author.pendingExtrinsics();

        const tips = pendingExtrinsics
            .filter(extrinsic => extrinsic.signer.toString() != excludingAddress)
            .map(extrinsic => Number(extrinsic.tip));

        return Math.max(...tips);
    }
}
