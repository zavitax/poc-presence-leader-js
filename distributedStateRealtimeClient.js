class DistributedStateRealtimeClient {
    get presenceRealtimeClient() {
        return this._presenceRealtimeClient;
    }

    get synchronized() {
        return this._isSynchronized;
    }

    constructor({
        presenceRealtimeClient,
        warmupTimeMilliseconds = 10000,
        compareStateCallback = (a, b) => { return 0; },
    }) {
        this._eventEmitter = new EventEmitter();

        this._presenceRealtimeClient = presenceRealtimeClient;
        this._compareStateCallback = compareStateCallback;

        this._isSynchronized = false;

        this._ParticipantStateChange = this._ParticipantStateChange.bind(this);

        this._presenceRealtimeClient.on('change', this._ParticipantStateChange);
        this._presenceRealtimeClient.on('stateChange', this._ParticipantStateChange);        

        this._warmupTimer = setTimeout(() => {
            this._warmupTimer = null;

            // Initialize state after allowing for enough time for all the participants to report their state
            this._syncState();
        }, warmupTimeMilliseconds);
    }

    async dispose() {
        if (this._warmupTimer) {
            clearTimeout(this._warmupTimer);
            this._warmupTimer = null;
        }

        await this._presenceRealtimeClient.dispose();

        await this._eventEmitter.dispose();
    }

    on(eventName, handler) {
        this._eventEmitter.on(eventName, handler);
    }

    off(eventName, handler) {
        this._eventEmitter.on(eventName, handler);
    }

    _ParticipantStateChange({ participant }) {
        if (this._warmupTimer) return; // Still warming up

        this._evalStates();
    }

    _syncState() {
        const members = [ ...this._presenceRealtimeClient.participants ];
        
        members.sort(this._compareStateCallback);

        const recent = members.pop();

        if (!recent?.data?.timestamp) {
            // Request to initialize state either to an empty state or the most recent state available in the group
            this._eventEmitter.emit('emptyState', recent?.data || {});

            this._warmupTimer = setTimeout(() => {
                this._warmupTimer = null;
    
                // Initialize state after allowing for enough time for all the participants to report their state
                this._syncState();
            }, warmupTimeMilliseconds);
        } else {
            this._presenceRealtimeClient.localState = recent.data;
            this._evalStates();
        }
    }

    _evalStates() {
        const first = this._presenceRealtimeClient.participants[0];

        for (const p of this._presenceRealtimeClient.participants) {
            if (this._compareStateCallback(first, p) !== 0) {
                // State mismatch in at least one participant
                if (this._isSynchronized) {
                    this._isSynchronized = false;

                    this._eventEmitter.emit('desync', {});
                }

                return;
            }
        }

        if (!this._isSynchronized) {
            this._isSynchronized = true;

            this._eventEmitter.emit('sync', {});
        }
    }
}
