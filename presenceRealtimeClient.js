class PresenceRealtimeClient {
    get participants() {
        return Object.values(this._participants);
    }

    get eventRealtimeClient() {
        return this._eventRealtimeClient;
    }

    get presenceData() {
        return this._requestDataCallback();
    }

    constructor({
        eventRealtimeClient,
        heartbeatIntervalMilliseconds = 15000,
        requestDataCallback = () => { return {}; },
    }) {
        this._eventEmitter = new EventEmitter();

        this._eventRealtimeClient = eventRealtimeClient;

        this._heartbeatIntervalMilliseconds = heartbeatIntervalMilliseconds;

        this._requestDataCallback = requestDataCallback;

        this._onEvent = this._onEvent.bind(this);

        this._eventRealtimeClient.on('presence:join', this._onEvent);
        this._eventRealtimeClient.on('presence:heartbeat', this._onEvent);
        this._eventRealtimeClient.on('presence:leave', this._onEvent);

        this._participants = {};

        this._heartbeatPromise = Promise.resolve();
        this._heartbeatTimer = null;

        this._eventRealtimeClient.emit('presence:join', {});

        this._heartbeat();

        this._housekeepInterval = setInterval(this._housekeep.bind(this));
    }

    async dispose() {
        clearInterval(this._housekeepInterval);

        await this._leave();

        await this._eventRealtimeClient.dispose();

        for (const p of Object.keys(this._participants)) {
            await this._onParticipantTimeout(p);
        }

        this._participants = {};
    }

    on(eventName, handler) {
        this._eventEmitter.on(eventName, handler);
    }

    off(eventName, handler) {
        this._eventEmitter.off(eventName, handler);
    }

    _housekeep () {
        const timeouts = [];
        
        for (const src of Object.keys(this._participants)) {
            const p = this._participants[src];

            const delta = Date.now() - p.timestamp;

            if (delta > this._heartbeatIntervalMilliseconds * 3.5) {
                // Timeout
                timeouts.push(src);
            }
        }

        for (const src of timeouts) {
            this._onParticipantTimeout({ src });
        }
    }

    async _onParticipantTimeout({ src }) {
        const p = this._participants[src];

        if (!p) return;

        delete this._participants[src];

        this._eventEmitter.emit('leave', { participant: p });
        this._eventEmitter.emit('change', { participants: this.participants || [] });
    }

    async _onParticipantHeartbeat({ src, data }) {
        //console.log(uuid, '_onParticipantHeartbeat: ', src);
        const isNewParticipant = !this._participants[src];

        this._participants[src] = this._participants[src] || { src, data };
        const p = this._participants[src];

        p.data = data;
        p.timestamp = new Date();

        if (isNewParticipant) {
            //console.log(uuid, 'new participant: ', src);
            this._eventEmitter.emit('join', { participant: p });
            this._eventEmitter.emit('change', { participants: this.participants || [] });

            if (src !== this.eventRealtimeClient.uuid) {
                // Someone new and not me - lets welcome them
                this.eventRealtimeClient.emit('presence:heartbeat', {});
            }
        }
    }

    async _onEvent(packet) {
        const { src, event, data } = packet;

        switch (event) {
            case 'presence:join':
            case 'presence:leave':
            case 'presence:heartbeat':
                await this._onParticipantHeartbeat(packet);
                break;
        }
    }

    async _leave() {
        await this._heartbeatPromise;

        clearTimeout(this._heartbeatTimer);

        await this._eventRealtimeClient.emit('presence:leave', {});
    }

    async _heartbeat() {
        this._heartbeatPromise = new Promise(async (resolve) => {
            const data = this._requestDataCallback();

            await this._eventRealtimeClient.emit('presence:heartbeat', data);

            this._heartbeatTimer = setTimeout(async () => {
                await this._heartbeat();
            }, this._heartbeatIntervalMilliseconds);

            resolve();
        });
    }
}
