class IndexedQueueTracker {
    get queue() {
        return this._queue;
    }

    constructor({
        eventRealtimeClient,
        formatIndexCallback,
        requestIndexedQueueItemsFromStorageCallback,
        maximumQueueLength = 1000,
    }) {
        this._eventEmitter = new EventEmitter();
        this._eventRealtimeClient = eventRealtimeClient;
        this._formatIndexCallback = formatIndexCallback;
        this._requestIndexedQueueItemsFromStorageCallback = requestIndexedQueueItemsFromStorageCallback;
        this._maximumQueueLength = maximumQueueLength;
      
        this._queue = [];

        this._onQueueItem = this._onQueueItem.bind(this);

        this._eventRealtimeClient.on('queue:item', this._onQueueItem);
    }

    async dispose() {
        this._eventRealtimeClient.off('queue:item', this._onQueueItem);

        await this._eventEmitter.dispose();
        await this._eventRealtimeClient.dispose();

        this._queue = [];
    }

    on(eventName, handler) {
        this._eventEmitter.on(eventName, handler);
    }

    off(eventName, handler) {
        this._eventEmitter.off(eventName, handler);
    }

    async dequeue() {
        // Return next item from buffer or `undefined`

        return this._queue.shift();
    }

    async dequeueAtQueueIndex({ queueIndex }) {
        // Return next item at specific `queueIndex`
        //
        // If `queueIndex` does not exist, backfill from `requestIndexedQueueItemsFromStorageCallback`

        // Look for `queueIndex`, removing older items
        while (this._queue.length > 0) {
            const item = this._queue.shift();

            if (item.queueIndex < queueIndex) {
                // Index too old
                continue;
            } else if (item.queueIndex == queueIndex) {
                // We found our item
                return item;
            } else {
                // Next item in queue is newer than requested index,
                // we have to backfill from storage
                this._queue.unshift(item);
                break;
            }
        }

        // Backfill from storage
        const items = await this._requestIndexedQueueItemsFromStorageCallback({
            queueIndex,
        });

        // Prepend items with queueIndex smaller than the first queue item to the queue
        for (let i = items.length - 1; i >= 0; --i) {
            const item = items[i];
            const queueIndex = this._formatIndexCallback(item);


            if (this._queue.length === 0 || queueIndex < this._queue[0].queueIndex) {
                this._queue.unshift({
                    queueIndex,
                    data: item,
                });
            }
        }

        if (this._queue[0]?.queueIndex === queueIndex) {
            // First queue item qualifies
            return this._queue.shift();
        }

        // No queue items qualify
        return undefined;
    }

    _onQueueItem({ data }) {
        const queueIndex = this._formatIndexCallback(data);

        this._queue.push({
            queueIndex,
            data: data,
        });

        // Remove older items if buffer too large
        while (this._queue.length > this._maximumQueueLength) {
            this._queue.shift();
        }

        this._eventEmitter.emit('change');
    }
}
