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
        if (eventName !== 'message') throw new Error('`message` expected as eventName');

        this._eventEmitter.on(eventName, handler);
    }

    off(eventName, handler) {
        if (eventName !== 'message') throw new Error('`message` expected as eventName');

        this._eventEmitter.off(eventName, handler);
    }

    emit(eventName, messageData) {
        if (eventName !== 'message') throw new Error('`message` expected as eventName');

        const json = JSON.stringify(messageData);

        setTimeout(() => {
            this._broadcastChannel.postMessage(json);
        }, 0);

        setTimeout(() => {
            this._handleMessageData(messageData, {});
        }, 0);
    }
}
