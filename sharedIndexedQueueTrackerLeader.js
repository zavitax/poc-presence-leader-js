class SharedIndexedQueueTrackerLeaderImpl {
    constructor({
        sharedIndexedQueueTracker,
        sharedLeaderElectionRealtimeClient,
        processQueueItemAsyncCallback,
    }) {
        this._quit = false;
        this._processing = false;

        // Shared means we won't dispose() it
        this._sharedIndexedQueueTracker = sharedIndexedQueueTracker;
        this._sharedLeaderElectionRealtimeClient = sharedLeaderElectionRealtimeClient;

        this._processQueueItemAsyncCallback = processQueueItemAsyncCallback;

        this._onPresenceChange = this._onPresenceChange.bind(this);
        this._onQueueChange = this._onQueueChange.bind(this);

        this._sharedLeaderElectionRealtimeClient.presenceRealtimeClient.on('change', this._onPresenceChange);
        this._sharedLeaderElectionRealtimeClient.presenceRealtimeClient.on('stateChange', this._onPresenceChange);
        this._sharedIndexedQueueTracker.on('change', this._onQueueChange);

        // Run first cycle of presence change
        this._onPresenceChange();
    }

    async dispose() {
        this._quit = true;

        this._sharedIndexedQueueTracker.off('change', this._onQueueChange);
        this._sharedLeaderElectionRealtimeClient.presenceRealtimeClient.off('stateChange', this._onPresenceChange);
        this._sharedLeaderElectionRealtimeClient.presenceRealtimeClient.off('change', this._onPresenceChange);
    }

    async _processNextItem() {
        if (this._quit) return;

        if (this._processing) return;

        this._processing = true;

        try {
            const item = await this._sharedIndexedQueueTracker.dequeue();

            if (!item) {
                this._processing = false;

                return;
            }

            if (this._quit) return;

            console.log('leader processing: ', item);

            // The leader is setting it's current state immediately for everyone to follow
            this._sharedLeaderElectionRealtimeClient.localState = {
                queueIndex: item.queueIndex,            
            };

            if (this._quit) return;

            // And only afterwards is processing the next queue item to be in sync
            // with all the followers
            await this._processQueueItemAsyncCallback({ data: item.data });
        } catch (e) {
            console.warn('IndexedQueueTrackerLeader: _processNextItem: error: ', e);
        }

        this._processing = false;

        if (this._isDistributedStateAligned()) {
            // If all participants are aligned, lets process the next item
            setTimeout(() => {
                this._processNextItem();
            }, 0);
        }
    }

    _onQueueChange() {
        if (this._quit) return;

        if (this._isDistributedStateAligned()) {
            this._processNextItem();
        }
    }

    _onPresenceChange() {
        if (this._quit) return;

        if (this._isDistributedStateAligned()) {
            this._processNextItem();
        }
    }

    _isDistributedStateAligned() {
        if (this._quit) return false;

        const queueIndex = this._sharedLeaderElectionRealtimeClient.localState.queueIndex || '';

        for (const p of this._sharedLeaderElectionRealtimeClient.presenceRealtimeClient.participants) {
            const participantQueueIndex = p.data?.data?.queueIndex || '';
            if (participantQueueIndex !== queueIndex) {
                return false;
            }
        }

        return true;
    }
}
