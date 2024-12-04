import fs from 'fs';
import path from 'path';
import { MultipleProducersSingleConsumerChannel } from './channel';

class LogWriter {
    private logFile: string;
    private stream?: fs.WriteStream;
    private channel = new MultipleProducersSingleConsumerChannel<string>();

    public constructor() {
        const programName = path.basename(process.argv[1], '.ts');

        const formattedDate = new Date()
            .toISOString()
            .split('.')[0]
            .replaceAll(':', '')
            .replaceAll('-', '')
            .replaceAll('Z', '')
            .replaceAll('T', '-');

        this.logFile = `logs/${programName}-console-output-${formattedDate}.log`;

        this.channel.runConsumeBatchForever(async lines => await this.writeImplementation(lines.join('')));
    }

    private async ensureStreamCreated() {
        if (!this.stream) {
            try {
                await fs.promises.mkdir('logs');
            } catch {
                // This is the case if the directory already exists.
                // If it doesn't exist though, we will still get an error upon trying to write to the log file.
            }
            this.stream = fs.createWriteStream(this.logFile);
        }
        return this.stream;
    }

    private async writeImplementation(text: string) {
        const stream = await this.ensureStreamCreated();
        await new Promise<void>((resolve, reject) => stream.write(text, error => (error ? reject(error) : resolve())));
    }

    public write(text: string) {
        this.channel.produce(text);
    }
}

const logWritter = new LogWriter();

logWritter.write(`[STARTED] ${new Date()}\n`);

// Save references to the original console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

function getDateTime() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

export function hookConsoleLogging() {
    // Override console.log
    console.log = (...args: unknown[]): void => {
        originalConsoleLog(...args); // Call the original method
        const message = [getDateTime(), '[LOG]', ...args].join(' ') + '\n';
        logWritter.write(message);
    };
    // Override console.error
    console.error = (...args: unknown[]): void => {
        originalConsoleError(...args); // Call the original method
        const message = [getDateTime(), '[ERROR]', ...args].join(' ') + '\n';
        logWritter.write(message);
    };
}

export function unhookConsoleLogging() {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
}
