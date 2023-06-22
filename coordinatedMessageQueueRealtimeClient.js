class CoordinatedMessageQueueRealtimeClient {
    get leaderElectionRealtimeClient() {
        return this._leaderElectionRealtimeClient;
    }

    get eventRealtimeClient() {
        return this._eventRealtimeClient;
    }

    get queue() {
        return this._queue;
    }

    constructor({
        eventRealtimeClient,
        leaderElectionRealtimeClient,
    }) {
        this._eventEmitter = new EventEmitter();

        this._eventRealtimeClient = eventRealtimeClient;
        this._leaderElectionRealtimeClient = leaderElectionRealtimeClient;

        this._queue = [];
        
        this._waitForAckResolveCalls = {};
        this._waitForAckPromise = Promise.resolve();
        this._currentAckToken = crypto.randomUUID();

        this._onLeaderChanged = this._onLeaderChanged.bind(this);

        this._onPresenceChange = this._onPresenceChange.bind(this);
        this._onJoin = this._onJoin.bind(this);

        this._onMsgEvent = this._onMsgEvent.bind(this);
        this._onAckEvent = this._onAckEvent.bind(this);
        this._onWelcomeEvent = this._onWelcomeEvent.bind(this);

        this._leaderElectionRealtimeClient.on('leaderStateChanged', this._onLeaderChanged);

        this._leaderElectionRealtimeClient.presenceRealtimeClient.on('change', this._onPresenceChange);
        //this._leaderElectionRealtimeClient.presenceRealtimeClient.on('join', this._onPresenceChange);
        //this._leaderElectionRealtimeClient.presenceRealtimeClient.on('leave', this._onPresenceChange);
        this._leaderElectionRealtimeClient.presenceRealtimeClient.on('join', this._onJoin);
        
        this._eventRealtimeClient.on('coordinated:msg', this._onMsgEvent);
        this._eventRealtimeClient.on('coordinated:ack', this._onAckEvent);
        this._eventRealtimeClient.on('coordinated:welcome', this._onWelcomeEvent);

        this._isProcessing = false;
    }

    async dispose() {
        this._eventRealtimeClient.off('coordinated:welcome', this._onWelcomeEvent);
        this._eventRealtimeClient.off('coordinated:msg', this._onMsgEvent);
        this._eventRealtimeClient.off('coordinated:ack', this._onAckEvent);

        this._eventRealtimeClient.off('coordinated:msg', this._onMsgEvent);
        this._eventRealtimeClient.off('coordinated:ack', this._onAckEvent);

        this._leaderElectionRealtimeClient.off('leaderStateChanged', this._onLeaderChanged);

        await this._eventEmitter.dispose();

        this._queue = [];

        this._resolveAllAckPromises();

        await this._waitForAckPromise; // Wait until promise is resolved

        this._leaderElectionRealtimeClient.presenceRealtimeClient.off('change', this._onPresenceChange);
        //this._leaderElectionRealtimeClient.presenceRealtimeClient.off('join', this._onPresenceChange);
        //this._leaderElectionRealtimeClient.presenceRealtimeClient.off('leave', this._onPresenceChange);
        this._leaderElectionRealtimeClient.presenceRealtimeClient.off('join', this._onJoin);

        await this._eventRealtimeClient.dispose();
        await this._leaderElectionRealtimeClient.dispose();
    }

    on(eventName, handler) {
        this._eventEmitter.on(eventName, handler);
    }

    off(eventName, handler) {
        this._eventEmitter.off(eventName, handler);
    }

    enqueue({ timestamp = Date.now(), nonce = crypto.randomUUID(), data }) {
        this._queue.push({
            timestamp,
            nonce,
            data,
        });

        if (this._leaderElectionRealtimeClient.isLeader) {
            console.log('queue: ', this._queue.length);
        }

        this._maybeProcessNextQueueItem();
    }

    _resolveAllAckPromises() {
        for (const ackResolveCall of Object.values(this._waitForAckResolveCalls)) {
            ackResolveCall();
        }
    }

    _onLeaderChanged({ isLeader }) {
        if (isLeader) {
            this._resolveAllAckPromises();
        }

        this._maybeProcessNextQueueItem();
    }

    _onJoin() {
        if (!this._leaderElectionRealtimeClient.isLeader) return;

        const nextQueueItem = this._queue[0] || null;

        this._eventRealtimeClient.emit('coordinated:welcome', {
            nextQueueItem,
        });
    }

    _onPresenceChange() {
        const map = {};

        this._leaderElectionRealtimeClient.presenceRealtimeClient.participants.forEach(curr => {
            map[curr.src] = curr;
        });

        //console.log(uuid, 'map: ', map);

        for (const member of Object.keys(this._waitForAckResolveCalls)) {
            if (!(member in map)) {
                // Waiting for participant which does not exist any more

                this._waitForAckResolveCalls[member](); // Resolve wait
                delete this._waitForAckResolveCalls[member];

                console.log('removed left member: ', member);
            }
        }

        this._maybeProcessNextQueueItem();
    }

    _onWelcomeEvent({ src, event, data: messageData }) {
        const { nextQueueItem } = messageData;

        console.log('_onWelcomeEvent: ', nextQueueItem);
    }

    _onMsgEvent({ src, event, data }) {
        const { ack: ackToken, member, data: messageData } = data;

        this._currentAckToken = ackToken; // Store current ack token for the message being processed

        this._eventEmitter.emit('message', {
            event,
            src,
            ackToken: ackToken,
            ack: () => {
                this._eventRealtimeClient.emit('coordinated:ack', {
                    ack: ackToken,
                    member: this._leaderElectionRealtimeClient.presenceRealtimeClient.eventRealtimeClient.uuid,
                });
            },
            data: messageData,
        });
    }

    _onAckEvent({ src, event, data }) {
        const { ack: ackToken, member, data: messageData } = data;

        if (ackToken != this._currentAckToken) {
            //console.warn('Received ack with mismatching ack token: ', ackToken, ' while expecting: ', this._currentAckToken);

            return;
        }

        const resolveCall = this._waitForAckResolveCalls[member];

        if (!resolveCall) {
            //console.warn('Missing resolve call for member: ', member, this._waitForAckResolveCalls, this._leaderElectionRealtimeClient.presenceRealtimeClient.participants);

            return;
        }

        resolveCall();

        this._maybeProcessNextQueueItem();
    }

    async _maybeProcessNextQueueItem() {
        if (!this._leaderElectionRealtimeClient.hasLeader) return;
        if (this._isProcessing) return;

        const item = this._queue.shift();

        if (!item) return;

        this._isProcessing = true;

        await this._waitForAckPromise;

        const promises = [];

        this._waitForAckResolveCalls = {};

        for (const p of this._leaderElectionRealtimeClient.presenceRealtimeClient.participants) {
            promises.push(new Promise(resolve => {
                this._waitForAckResolveCalls[p.src] = resolve;
            }));
        }

        this._waitForAckPromise = Promise.allSettled(promises);

        if (this._leaderElectionRealtimeClient.isLeader) {
            // This will be also set in _onMsgEvent, but since we are the leader, lets also set it here
            this._currentAckToken = crypto.randomUUID();

            // I'm the leader, I'm sending the messages to be acknowledged
            this._eventRealtimeClient.emit('coordinated:msg', {
                ack: this._currentAckToken,
                //member: this._leaderElectionRealtimeClient.presenceRealtimeClient.eventRealtimeClient.uuid,
                data: item,
            });
        }

        // Wait until all participants acknowledged the message
        await this._waitForAckPromise;

        console.log('promises settled: ', promises.length, '  queue length: ', this._queue.length);

        this._isProcessing = false;

        if (this._queue.length > 0) {
            setTimeout(this._maybeProcessNextQueueItem.bind(this), 0); // Check for next message to be processed
        }
    }
}
