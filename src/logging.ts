import fs from 'fs/promises';
import { MultipleProducersSingleConsumerChannel } from './channel';

const formattedDate = new Date()
    .toISOString()
    .split('.')[0]
    .replaceAll(':', '')
    .replaceAll('-', '')
    .replaceAll('Z', '')
    .replaceAll('T', '-');

// Define the log file
const logFile = `logs/console-output-${formattedDate}.log`;

const channel = new MultipleProducersSingleConsumerChannel<string>();

channel.produce(`[STARTED] ${new Date()}\n`);

// Save references to the original console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

export function hookConsoleLogging() {
    // Override console.log
    console.log = (...args: unknown[]): void => {
        originalConsoleLog(...args); // Call the original method
        const message = ['[LOG]', ...args].join(' ') + '\n';
        channel.produce(message);
    };
    // Override console.error
    console.error = (...args: unknown[]): void => {
        originalConsoleError(...args); // Call the original method
        const message = args.join(' ') + '\n';
        channel.produce(`[ERROR] ${message}`);
    };
}

export function unhookConsoleLogging() {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
}

async function run() {
    try {
        await fs.mkdir('logs');
    } catch {
        // This is the case if the directory already exists.
        // If it doesn't exist though, we will still get an error upon trying to write to the log file.
    }
    await channel.runConsumeForever(async line => await fs.appendFile(logFile, line));
}

run();
