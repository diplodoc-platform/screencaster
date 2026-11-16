import {SNAPSHOT_URL_REGEXP} from '../constants.js';

export const extractUrlFromSnapshot = (snapshot: string) => {
    const m = snapshot.match(SNAPSHOT_URL_REGEXP);
    return m ? m[1] : '';
};
