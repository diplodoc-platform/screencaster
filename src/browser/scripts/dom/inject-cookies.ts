import type {Cookie} from 'playwright';
export default function injectCookies(cookies: Partial<Cookie>[]) {
    for (const c of cookies) {
        document.cookie =
            c.name + '=' + c.value + '; path=' + c.path + (c.secure ? '; Secure' : '');
    }
    return 'ok: ' + cookies.length;
}
