class EventRealtimeClient {
    get uuid() {
        return this._uuid;
    }

    constructor({
        realtimeEventEmitterProvider
    }) {
        this._uuid = crypto.randomUUID();

        this._onMessageData = this._onMessageData.bind(this);

        this._eventEmitter = new EventEmitter();

        this._realtimeEventEmitterProvider = realtimeEventEmitterProvider;

        const self = this;

        const eventNames = [ 'connect', 'reconnect', 'ready', 'disconnect' ];
        this._events = {};
        eventNames.forEach(name => {
            this._events[name] = (data) => {
                this._eventEmitter.emit(name, data);
            };
        });

        this._initPromise = new Promise(async (resolve, reject) => {
            this._realtimeEventEmitterProvider.createRealtimeEventEmitter().then((result) => {
                self._realtimeEventEmitter = result;
                self._realtimeEventEmitter.on('message', this._onMessageData);

                for (const event of Object.keys(self._events)) {
                    this._realtimeEventEmitter.on(event, self._events[event]);
                }

                resolve();
            }).catch(reject);
        });
    }

    async dispose() {
        await this._eventEmitter.dispose();

        await Promise.allSettled([this._initPromise]);

        this._realtimeEventEmitter?.off('message', this._onMessageData);

        for (const event of Object.keys(this._events)) {
            this._realtimeEventEmitter.off(event, this._events[event]);
        }

        await this?._realtimeEventEmitter.dispose();
        await this._realtimeEventEmitterProvider.dispose();
    }

    _onMessageData({ messageData }) {
        const packet = messageData;

        if (packet.src === this._uuid) {
            packet.loopback = true;
        } else {
            packet.loopback = false;
        }

        this._eventEmitter.emit(packet.event, packet);
    }

    async emit(eventName, data) {
        await this._initPromise;

        const packet = {
            src: this._uuid,
            event: eventName,
            data,
        };

        this._realtimeEventEmitter.emit('message', packet);
    }

    on(eventName, handler) {
        this._eventEmitter.on(eventName, handler);
    }

    off(eventName, handler) {
        this._eventEmitter.off(eventName, handler);
    }
}
