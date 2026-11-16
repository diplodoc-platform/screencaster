import type {SnapshotPage} from '../shared/snapshot/page.js';

type PageState =
    | {kind: 'unverified'}
    | {kind: 'verified'; page: SnapshotPage}
    | {kind: 'dispatching'; owner?: SnapshotPage}
    | {kind: 'returned'; owner?: SnapshotPage}
    | {kind: 'native-dialog'; owner?: SnapshotPage; cancelOnly: boolean};

export class DialogState {
    private state: PageState = {kind: 'unverified'};

    get verifiedPage(): SnapshotPage | undefined {
        return this.state.kind === 'verified' ? this.state.page : undefined;
    }

    get owner(): SnapshotPage | undefined {
        return 'owner' in this.state ? this.state.owner : undefined;
    }

    get pending(): boolean {
        return this.state.kind === 'native-dialog';
    }

    get cancelOnly(): boolean {
        return this.state.kind === 'native-dialog' && this.state.cancelOnly;
    }

    invalidate(): void {
        this.state = {kind: 'unverified'};
    }

    verify(page: SnapshotPage): void {
        this.state = {kind: 'verified', page};
    }

    beginDispatch(dialogAnswer: boolean): SnapshotPage | undefined {
        const owner = this.verifiedPage ?? (dialogAnswer ? this.owner : undefined);
        this.state = {kind: 'dispatching', owner};
        return owner;
    }

    returned(owner?: SnapshotPage): void {
        this.state = {kind: 'returned', owner};
    }

    unknown(): void {
        this.invalidate();
    }

    observeNative(page: SnapshotPage): void {
        const owner = this.owner;
        const cancelOnly =
            this.cancelOnly ||
            Boolean(owner && (owner.url !== page.url || owner.index !== page.index));
        this.state = {kind: 'native-dialog', owner, cancelOnly};
    }
}
