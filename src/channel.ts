export class MultipleProducersSingleConsumerChannel<T> {
    private queue: T[] = [];
    private resolveQueue: ((value: T) => void)[] = [];
    private isClosed = false;

    // Add a new item to the queue (producer side)
    public produce(item: T): void {
        if (this.isClosed) {
            throw new Error('Channel is closed.');
        }

        if (this.resolveQueue.length > 0) {
            const resolve = this.resolveQueue.shift();
            if (resolve) {
                resolve(item);
            }
        } else {
            this.queue.push(item);
        }
    }

    // Consume an item from the queue (consumer side)
    public async consume(): Promise<T> {
        if (this.isClosed && this.queue.length === 0) {
            throw new Error('Channel is closed and no items are left.');
        }

        if (this.queue.length > 0) {
            return this.queue.shift()!;
        }

        return new Promise<T>(resolve => {
            this.resolveQueue.push(resolve);
        });
    }

    // Consume all items in the channel, calling the given function for each.
    // Terminates with an exception when `this.close()` is called.
    public async runConsumeForever(action: (item: T) => Promise<void>) {
        while (true) await action(await this.consume());
    }

    // Close the channel (no more items can be produced)
    public close(): void {
        this.isClosed = true;
    }
}
