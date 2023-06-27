class IndexedQueueProcessingCoordinator {
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

        this._leaderElectionRealtimeClient.on('leaderStateChanged', this._onLeaderStateChanged);
    }

    async dispose() {
        this._leaderElectionRealtimeClient.off('leaderStateChanged', this._onLeaderStateChanged);

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
