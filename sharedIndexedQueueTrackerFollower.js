class SharedIndexedQueueTrackerFollowerImpl {
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

        this._sharedLeaderElectionRealtimeClient.presenceRealtimeClient.on('change', this._onPresenceChange);
        this._sharedLeaderElectionRealtimeClient.presenceRealtimeClient.on('stateChange', this._onPresenceChange);

        // Run first cycle of presence change
        this._onPresenceChange();
    }

    async dispose() {
        this._quit = true;

        this._sharedLeaderElectionRealtimeClient.presenceRealtimeClient.off('stateChange', this._onPresenceChange);
        this._sharedLeaderElectionRealtimeClient.presenceRealtimeClient.off('change', this._onPresenceChange);
    }

    async _processNextItem() {
        if (this._quit) return;
        if (this._processing) return;

        this._processing = true;

        try {
            const queueIndex = this._getExpectedQueueIndex();

            if (!queueIndex) {
                this._processing = false;

                return;
            }

            const item = await this._sharedIndexedQueueTracker.dequeueAtQueueIndex({ queueIndex });

            if (this._quit) return;

            if (!item) {
                console.warn('Could not fetch items from storage starting at queueIndex: ', queueIndex, this._sharedIndexedQueueTracker.queue);

                // Update it's state to requested queueIndex signal the leader we caught up
                this._sharedLeaderElectionRealtimeClient.localState = {
                    queueIndex,
                };
            } else {
                // The follower is processing the item first
                await this._processQueueItemAsyncCallback({
                    queueIndex: item.queueIndex,
                    data: item.data,
                });

                // And only then updating it's state to signal the leader we caught up
                this._sharedLeaderElectionRealtimeClient.localState = {
                    queueIndex: item.queueIndex,            
                };
            }

            if (this._quit) return;
        } catch (e) {
            console.warn('IndexedQueueTrackerFollower: _processNextItem: error: ', e);
        }

        this._processing = false;

        if (this._sharedIndexedQueueTracker.queue.length > 0) {
            setTimeout(() => {
                this._processNextItem();
            }, 0);
        }
    }

    _onPresenceChange() {
        if (this._quit) return;

        this._processNextItem();
    }

    _getExpectedQueueIndex() {
        if (this._quit) return '';

        for (const p of this._sharedLeaderElectionRealtimeClient.presenceRealtimeClient.participants) {
            if (p.data?.isLeader) {
                const queueIndex = p.data.data?.queueIndex || '';
                const localQueueIndex = this._sharedLeaderElectionRealtimeClient.localState?.queueIndex || '';

                if (queueIndex !== localQueueIndex) {
                    return queueIndex;
                } else {
                    // Found a leader, and no index advancement is necessary
                    break;
                }
            }
        }

        return '';
    }
}
