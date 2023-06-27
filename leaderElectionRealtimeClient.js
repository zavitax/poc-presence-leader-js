class LeaderElectionRealtimeClientProvider {
    constructor({
        presenceRealtimeClient,
        warmupTimeMilliseconds = 10000,
        reactTimeMilliseconds = 1000,
    }) {
        this._presenceRealtimeClient = presenceRealtimeClient;
        this._warmupTimeMilliseconds = warmupTimeMilliseconds;
        this._reactTimeMilliseconds = reactTimeMilliseconds;
    }

    async dispose() {
        await this._presenceRealtimeClient.dispose();
    }

    async createLeaderElectionRealtimeClient({
        compareParticipantsCallback,
        initialState = {},
    }) {
        return new LeaderElectionRealtimeClient({
            presenceRealtimeClient: this._presenceRealtimeClient,
            warmupTimeMilliseconds: this._warmupTimeMilliseconds,
            reactTimeMilliseconds: this._reactTimeMilliseconds,
            compareParticipantsCallback,
            initialState,
        });
    }
}

class LeaderElectionRealtimeClient {
    get presenceRealtimeClient() {
        return this._presenceRealtimeClient;
    }

    get isLeader() {
        return this._leader?.src === this._presenceRealtimeClient.eventRealtimeClient.uuid;
    }

    get hasLeader() {
        return !!this._leader;
    }

    get localState() {
        return this._presenceRealtimeClient.localState.data || {};
    }

    set localState(value) {
        this._presenceRealtimeClient.localState = {
            isLeader: this.isLeader,
            data: value || {},
        };
    }

    constructor({
        presenceRealtimeClient,
        compareParticipantsCallback,
        warmupTimeMilliseconds = 10000,
        reactTimeMilliseconds = 1000,
    }) {
        this._eventEmitter = new EventEmitter();

        this._compareParticipantsCallback = compareParticipantsCallback;
        this._presenceRealtimeClient = presenceRealtimeClient;

        this._warmupTimeMilliseconds = warmupTimeMilliseconds;
        this._reactTimeMilliseconds = reactTimeMilliseconds;
        this._isWarm = false;

        this._onPresenceChange = this._onPresenceChange.bind(this);
        this._onPresenceJoin = this._onPresenceJoin.bind(this);
        this._onPresenceLeave = this._onPresenceLeave.bind(this);

        this._presenceRealtimeClient.on('change', this._onPresenceChange);
        this._presenceRealtimeClient.on('join', this._onPresenceJoin);
        this._presenceRealtimeClient.on('leave', this._onPresenceLeave);

        this._onLeaderRequested = this._onLeaderRequested.bind(this);
        this._onLeaderAnnounced = this._onLeaderAnnounced.bind(this);

        this._presenceRealtimeClient.eventRealtimeClient.on('leader:requested', this._onLeaderRequested);
        this._presenceRealtimeClient.eventRealtimeClient.on('leader:announced', this._onLeaderAnnounced);

        this._onDisconnect = this._onDisconnect.bind(this);
        this._onReconnect = this._onReconnect.bind(this);

        this._presenceRealtimeClient.eventRealtimeClient.on('disconnect', this._onDisconnect);
        this._presenceRealtimeClient.eventRealtimeClient.on('ready', this._onReconnect);

        this._leaderTimer = null;
        this._leader = null;
        this._lastLeaderState = null;

        this._requestLeader();
    }

    async dispose() {
        if (this._leaderTimer) {
            clearTimeout(this._leaderTimer);
            this._leaderTimer = null;
        }

        this._presenceRealtimeClient.eventRealtimeClient.off('disconnect', this._onDisconnect);
        this._presenceRealtimeClient.eventRealtimeClient.off('ready', this._onReconnect);

        this._presenceRealtimeClient.eventRealtimeClient.off('leader:requested', this._onLeaderRequested);
        this._presenceRealtimeClient.eventRealtimeClient.off('leader:announced', this._onLeaderAnnounced);

        this._presenceRealtimeClient.off('leave', this._onPresenceLeave);
        this._presenceRealtimeClient.off('join', this._onPresenceJoin);
        this._presenceRealtimeClient.off('change', this._onPresenceChange);

        await this._presenceRealtimeClient.dispose();

        const wasLeader = this.isLeader;

        // Not a leader
        this._leader = null;

        if (wasLeader) {
            this._eventEmitter.emit('leaderStateChanged', { isLeader: false });

            // this._refreshLocalState(); // Nothing to communicate to
        }
    }

    on(eventName, handler) {
        this._eventEmitter.on(eventName, handler);
    }

    off(eventName, handler) {
        this._eventEmitter.off(eventName, handler);
    }

    _onDisconnect() {
        this._leader = null;

        if (this._leaderTimer) {
            clearTimeout(this._leaderTimer);
            this._leaderTimer = null;
        }

        if (this._lastLeaderState) {
            this._eventEmitter.emit('leaderStateChanged', { isLeader: this.isLeader });

            this._refreshLocalState();
        }

        this._lastLeaderState = null;
        this._isWarm = false;
    }

    _onReconnect() {
        this._requestLeader();
    }

    _onPresenceJoin({ participant }) {
        /*if (this.isLeader) {
            // Claim leadership
            this._claimLeadership();
        } else {
            // Re-evaluate leadership when someone joins
            this._evalLeader();
        }*/
    }

    _onPresenceLeave({ participant }) {
        // Re-evaluate leadership when someone leaves
        //this._evalLeader();
    }

    _onPresenceChange({ participants }) {
        if (!this._leaderExists() && this._isWarm) {
            // Re-evaluate leadership when presence information changes
            this._evalLeader();
        }
    }

    _onLeaderRequested() {
        // See if leader election is in order
        this._evalLeader();

        setTimeout(() => {
            // Additional pass
            this._evalLeader();
        }, this._warmupTimeMilliseconds);
    }

    _onLeaderAnnounced(packet) {
        this._leader = packet;

        if (this.isLeader !== this._lastLeaderState) {
            this._lastLeaderState = this.isLeader;

            this._eventEmitter.emit('leaderStateChanged', { isLeader: this.isLeader });

            this._refreshLocalState();
        }
    }

    _requestLeader() {
        this._presenceRealtimeClient.eventRealtimeClient.emit('leader:requested', {
            ...this._presenceRealtimeClient.localState,
        });

        this._eventEmitter.emit('leaderRequested', {});

        setTimeout(() => {
            // Additional pass
            this._evalLeader();
        }, this._warmupTimeMilliseconds);
    }

    _evalLeader() {
        if (this._leaderTimer) {
            clearTimeout(this._leaderTimer);

            this._leaderTimer = null;
        }

        if (this.isLeader) {
            // Claim leadership
            // this._claimLeadership();
        }

        this._leaderTimer = setTimeout(() => {
            this._isWarm = true;

            this._leaderTimer = null;

            this._evalLeaderExec();
        }, this._isWarm ? this._reactTimeMilliseconds : this._warmupTimeMilliseconds);
    }

    _leaderExists() {
        for (const p of this._presenceRealtimeClient.participants) {
            if (p.localState?.isLeader) {
                return true;
            }
        }

        return false;
    }

    _evalLeaderExec() {
        if (this._leaderExists()) {
            // Don't swap a leader which already exists
            return;
        }

        const participants = [ ... this._presenceRealtimeClient.participants ];
            
        participants.sort(this._compareParticipantsCallback);

        const leader = participants[0];

        if (leader) {
            if (leader?.src === this._presenceRealtimeClient.eventRealtimeClient.uuid) {
                this._leader = leader;

                this._claimLeadership();
            }
        } else {
            const wasLeader = this.isLeader;

            // No leaders left
            this._leader = null;

            if (wasLeader) {
                this._eventEmitter.emit('leaderStateChanged', { isLeader: false });

                this._refreshLocalState();
            }
        }
    }

    _claimLeadership() {
        // Restate leadership
        this._presenceRealtimeClient.eventRealtimeClient.emit('leader:announced', {
            ...this._presenceRealtimeClient.localState,
        });

        // Refresh local state
        this._refreshLocalState();
    }

    _refreshLocalState() {
        if (this._presenceRealtimeClient.localState?.isLeader === this.isLeader) {
            // Prevent duplicate updates
            return;
        }

        this.localState = this.localState;
    }
}