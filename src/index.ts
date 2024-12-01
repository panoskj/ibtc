import { createInterBtcService } from './service';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    if (!process.env.MNEMONIC) throw new Error('MNEMONIC must be specified in the .env file.');

    const service = await createInterBtcService();

    await service.login(process.env.MNEMONIC);

    const tasks = [service.runRemainingQty(3000), service.runAllVaults(0.1)];

    await Promise.all(tasks);

    await service.disconnect();
}

main();
