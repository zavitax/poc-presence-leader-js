class IndexedQueueProcessingCoordinator {
    static COMPARE_PARTICIPANT_QUEUE_INDEX(a, b) {
        function stremptycmp(av, bv) {
            if (av === '') {
                if (bv === av) {
                    return 0;
                } else {
                    return 1;
                }
            } else if (bv === '') {
                if (av === bv) {
                    return 0;
                } else {
                    return -1;
                }
            }

            return 0;
        }

        function strcmp(av, bv) {
            const r = stremptycmp(av, bv);

            if (r !== 0) return r;

            if (av < bv) return -1;
            if (av > bv) return 1;
            return 0;
        }

        return strcmp(a?.data?.data?.queueIndex, b?.data?.queueIndex) || strcmp(a?.src, b?.src);
    }
    
    constructor({
        indexedQueueTracker,
        leaderElectionRealtimeClient,
        processQueueItemAsyncCallback,
    }) {
        this._indexedQueueTracker = indexedQueueTracker;
        this._leaderElectionRealtimeClient = leaderElectionRealtimeClient;
        this._processQueueItemAsyncCallback = processQueueItemAsyncCallback;

        this._trackerImpl = null;

        this._onLeaderStateChanged = this._onLeaderStateChanged.bind(this);

        this._leaderElectionRealtimeClient.on('leadershipStateChanged', this._onLeaderStateChanged);
    }

    async dispose() {
        this._leaderElectionRealtimeClient.off('leadershipStateChanged', this._onLeaderStateChanged);

        if (this._trackerImpl) {
            await this._trackerImpl.dispose();
        }

        await this._leaderElectionRealtimeClient.dispose();
        await this._indexedQueueTracker.dispose();
    }

    async _onLeaderStateChanged({ isLeader }) {
        if (this._trackerImpl) {
            await this._trackerImpl.dispose();
            this._trackerImpl = null;
        }

        if (isLeader) {
            this._trackerImpl = new SharedIndexedQueueTrackerLeaderImpl({
                sharedLeaderElectionRealtimeClient: this._leaderElectionRealtimeClient,
                sharedIndexedQueueTracker: this._indexedQueueTracker,
                processQueueItemAsyncCallback: this._processQueueItemAsyncCallback,
            });
        } else {
            this._trackerImpl = new SharedIndexedQueueTrackerFollowerImpl({
                sharedLeaderElectionRealtimeClient: this._leaderElectionRealtimeClient,
                sharedIndexedQueueTracker: this._indexedQueueTracker,
                processQueueItemAsyncCallback: this._processQueueItemAsyncCallback,
            });
        }
    }
}
