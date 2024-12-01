import { createInterBtcService } from './service';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    if (!process.env.MNEMONIC) throw new Error('MNEMONIC must be specified in the .env file.');

    const service = await createInterBtcService();

    await service.login(process.env.MNEMONIC);

    console.log(await service.getCurrentMaxTip());

    //await seeMempool(interBTC);

    // await inspectTx(interBTC,
    // 	'0xf0059e357cec3e1b2b0550b5cf267375a3225bdd71291b27c9cabc1ff8e480d7',
    // 	'0x68b79863ef06bda22c7f6959e2e586f6e63716c587e997717efbb269b831cf80');

    //const vaults = await interBTC.vaults.list();

    //await Promise.all(vaults.map(vault => runVault(interBTC, vault)));

    // When finished using the API, disconnect to allow Node scripts to gracefully terminate
    await service.interBTC.disconnect();
}

main();
