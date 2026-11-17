import type {ScriptPage} from '../types.js';
export default async function script(page: ScriptPage) {
    const video = page.video();
    return video ? await video.path() : null;
}
