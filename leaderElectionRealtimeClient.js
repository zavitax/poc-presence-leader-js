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

    constructor({
        presenceRealtimeClient,
        requestSortParticipantsCallback,
        warmupTimeMilliseconds = 3000,
        allowLeaderDemotion = false,
    }) {
        this._eventEmitter = new EventEmitter();

        this._requestSortParticipantsCallback = requestSortParticipantsCallback;
        this._presenceRealtimeClient = presenceRealtimeClient;

        this._warmupTimeMilliseconds = warmupTimeMilliseconds;
        this._isWarm = false;

        this._allowLeaderDemotion = allowLeaderDemotion;

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
        }
    }

    on(eventName, handler) {
        this._eventEmitter.on(eventName, handler);
    }

    off(eventName, handler) {
        this._eventEmitter.off(eventName, handler);
    }

    _onPresenceJoin({ participant }) {
        if (this.isLeader) {
            // Claim leadership
            this._claimLeadership();
        } else {
            // Re-evaluate leadership when someone joins
            this._evalLeader();
        }
    }

    _onPresenceLeave({ participant }) {
        // Re-evaluate leadership when someone leaves
        this._evalLeader();
    }

    _onPresenceChange({ participants }) {
        // Re-evaluate leadership when presence information changes
        this._evalLeader();
    }

    _onLeaderRequested() {
        if (this.isLeader) {
            this._claimLeadership();
        } else {
            // See if leader election is in order
            this._evalLeader();
        }
    }

    _onLeaderAnnounced(packet) {
        this._leader = packet;

        if (this.isLeader !== this._lastLeaderState) {
            this._lastLeaderState = this.isLeader;

            this._eventEmitter.emit('leaderStateChanged', { isLeader: this.isLeader });
        }
    }

    _requestLeader() {
        this._presenceRealtimeClient.eventRealtimeClient.emit('leader:requested', {
            ...this._presenceRealtimeClient.presenceData,
        });

        this._eventEmitter.emit('leaderRequested', {});
    }

    _evalLeader() {
        if (this._leaderTimer) {
            clearTimeout(this._leaderTimer);

            this._leaderTimer = null;
        }

        this._leaderTimer = setTimeout(() => {
            this._isWarm = true;

            this._leaderTimer = null;

            this._evalLeaderExec();
        }, this._isWarm ? 0 : this._warmupTimeMilliseconds);
    }

    _leaderExists() {
        if (this._leader?.src in this.presenceRealtimeClient.participants) {
            return true;
        }

        return false;
    }

    _evalLeaderExec() {
        if (this._leaderExists() && !this._allowLeaderDemotion) {
            // Don't swap a leader which already exists
            return;
        }

        const participants = [ ... this._presenceRealtimeClient.participants ];
            
        participants.sort(this._requestSortParticipantsCallback);

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
            }
        }
    }

    _claimLeadership() {
        // Restate leadership
        this._presenceRealtimeClient.eventRealtimeClient.emit('leader:announced', {
            ...this._presenceRealtimeClient.presenceData,
        });
   }
}