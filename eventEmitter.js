/*
interface IDisposable {
    dispose();
}

interface RealtimeEventEmitterProvider extends IDisposable {
    createRealtimeEventEmitter();
}

interface RealtimeEventEmitter extends IDisposable {
    on(eventName, handler);
    off(eventName, handler);
    emit(eventName, data);
}
*/

class EventEmitter {
    constructor() {
        this._listeners = {};
    }

    dispose() {
        this._listeners = {};
    }

    on(eventName, handler) {
        this._listeners[eventName] = this._listeners[eventName] || [];

        if (this._listeners[eventName].filter(i => i === handler).length > 0) return;

        this._listeners[eventName].push(handler);
    }

    off(eventName, handler) {
        if (!this._listeners[eventName]) return;
        if (this._listeners[eventName].filter(i => i === handler).length === 0) return;

        this._listeners[eventName] = this._listeners[eventName].filter(i => i !== handler);
        
        if (this._listeners[eventName].length === 0) {
            delete this._listeners[eventName];
        }
    }

    emit(eventName, data) {
        this._listeners[eventName]?.forEach(handler => {
            handler(data);
        });
    }
}

class BroadcastChannelRealtimeEventEmitterProvider /*implements RealtimeEventEmitterProvider*/ {
    constructor({ broadcastChannelName }) {
        this._broadcastChannelName = broadcastChannelName;
    }

    async createRealtimeEventEmitter() {
        return new BroadcastChannelRealtimeEventEmitter({
            broadcastChannelName: this._broadcastChannelName,
        });
    }

    async dispose() {
        this._broadcastChannelName = null;
    }
}

class BroadcastChannelRealtimeEventEmitter /*implements RealtimeEventEmitter */ {
    constructor({ broadcastChannelName }) {
        this._eventEmitter = new EventEmitter();

        this._listeners = {};
        this._broadcastChannel = new BroadcastChannel(broadcastChannelName);

        this._onMessage = this._onMessage.bind(this);

        this._broadcastChannel.addEventListener('message', this._onMessage);

        setTimeout(() => {
            this._eventEmitter.emit('connect');
            this._eventEmitter.emit('ready');
        }, 0);
    }

    async dispose() {
        this._broadcastChannel.removeEventListener('message', this._onMessage);

        this._broadcastChannel.close();

        await this._eventEmitter.dispose();
    }

    _onMessage(event) {
        const messageData = JSON.parse(event.data);

        this._handleMessageData(messageData, event);
    }

    _handleMessageData(messageData, _event) {
        this._eventEmitter.emit('message', { messageData });
    }

    on(eventName, handler) {
        this._eventEmitter.on(eventName, handler);
    }

    off(eventName, handler) {
        this._eventEmitter.off(eventName, handler);
    }

    emit(eventName, messageData) {
        const json = JSON.stringify(messageData);

        setTimeout(() => {
            this._broadcastChannel.postMessage(json);
        }, 0);

        setTimeout(() => {
            this._handleMessageData(messageData, {});
        }, 0);
    }
}

class WebsocketRealtimeEventEmitterProvider /*implements RealtimeEventEmitterProvider*/ {
    constructor({ websocketUrl }) {
        this._websocketUrl = websocketUrl;
    }

    async createRealtimeEventEmitter() {
        return new WebsocketRealtimeEventEmitter({
            websocketUrl: this._websocketUrl,
        });
    }

    async dispose() {
        this._websocketUrl = null;
    }
}

class WebsocketRealtimeEventEmitter /*implements RealtimeEventEmitter */ {
    constructor({
        websocketUrl,
        reconnectDelayMilliseconds = 1000,
    }) {
        this._eventEmitter = new EventEmitter();
        this._websocketUrl = websocketUrl;
        this._reconnectDelayMilliseconds = reconnectDelayMilliseconds;

        this._onMessage = this._onMessage.bind(this);
        this._onError = this._onError.bind(this);

        this._readyPromise = Promise.resolve();

        this._connect(true);
    }

    async dispose() {
        this._disconnect();

        await this._eventEmitter.dispose();
    }

    _connect(isFirst = false) {
        const delayMs = isFirst ? 0 : this._reconnectDelayMilliseconds;

        const self = this;

        this._readyPromise = new Promise((resolve, reject) => {
            setTimeout(() => {
                self._ws = new WebSocket(this._websocketUrl);
                self._ws.addEventListener('close', this._onError);
                self._ws.addEventListener('error', this._onError);
                self._ws.addEventListener('message', this._onMessage);

                function teardown() {
                    self._ws?.removeEventListener('open', open);
                    self._ws?.removeEventListener('error', open);  
                }

                function error() {
                    teardown();
                    reject(new Error('Failed to connect'));
                }

                function open() {
                    console.log('connected');
                    teardown();
                    resolve();

                    if (isFirst) {
                        self._eventEmitter.emit('connect');
                    } else {
                        self._eventEmitter.emit('reconnect');
                    }

                    self._eventEmitter.emit('ready');
                }

                this._ws.addEventListener('open', open);
                this._ws.addEventListener('error', error);
            }, delayMs);
        });
    }

    _disconnect() {
        this._eventEmitter.emit('disconnect');

        this._ws.removeEventListener('message', this._onMessage);
        this._ws.removeEventListener('close', this._onError);
        this._ws.removeEventListener('error', this._onError);
        this._ws.close();
        this._ws = null;
    }

    _onError(event) {
        this._disconnect();
        this._connect();
    }

    _onMessage(event) {
        this._eventEmitter.emit('message', { messageData: JSON.parse(event.data) });
    }

    on(eventName, handler) {
        this._eventEmitter.on(eventName, handler);
    }

    off(eventName, handler) {
        this._eventEmitter.off(eventName, handler);
    }

    async emit(eventName, messageData) {
        try {
            await this._readyPromise;

            const json = JSON.stringify(messageData);

            this._ws.send(json);
        } catch (e) {
            // Failed to connect
        }
    }
}
