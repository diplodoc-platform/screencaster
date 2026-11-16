import {SNAPSHOT_URL_REGEXP} from '../constants.js';

export const extractUrlFromSnapshot = (snapshot: string) => {
    const m = SNAPSHOT_URL_REGEXP.exec(snapshot);
    return m ? m[1] : '';
};
