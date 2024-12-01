import { createInterBtcService } from './service';
import { hookConsoleLogging } from './logging';
import * as dotenv from 'dotenv';

async function main() {
    hookConsoleLogging();

    dotenv.config();

    if (!process.env.MNEMONIC) throw new Error('MNEMONIC must be specified in the .env file.');

    const service = await createInterBtcService();

    await service.login(process.env.MNEMONIC);

    const tasks = [service.runRemainingQty(3000), service.runAllVaults(0.1)];

    await Promise.all(tasks);

    await service.disconnect();
}

main();
