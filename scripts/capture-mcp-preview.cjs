const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function capture() {
    const [browser, directory] = process.argv.slice(1);
    const profile = path.join(directory, 'browser');
    const child = spawn(browser, [
        '--headless', '--disable-gpu', '--disable-background-networking',
        '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile,
        pathToFileURL(path.join(directory, 'preview.html')).href,
    ], {stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});
    let socket;
    let diagnostics = '';
    child.stderr.on('data', chunk => {
        diagnostics = (diagnostics + chunk).slice(-2000);
    });
    child.on('error', error => {
        diagnostics = error.message;
    });
    try {
        let target;
        const deadline = Date.now() + 25000;
        while (!target && Date.now() < deadline && child.exitCode === null) {
            try {
                const port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
                const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
                target = pages.find(page => page.url.endsWith('/preview.html'));
            } catch {
            }
            if (!target) await delay(100);
        }
        if (!target) throw Error('Chromium preview page did not start (' + child.exitCode + '): ' + diagnostics.trim());
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, {once: true});
            socket.addEventListener('error', reject, {once: true});
        });
        let nextId = 0;
        const call = (method, params) => new Promise((resolve, reject) => {
            const id = ++nextId;

            function receive(event) {
                const message = JSON.parse(event.data);
                if (message.id !== id) return;
                socket.removeEventListener('message', receive);
                if (message.error) reject(Error(message.error.message));
                else resolve(message.result);
            }

            socket.addEventListener('message', receive);
            socket.send(JSON.stringify({id, method, params}));
        });
        let report;
        while (!report && Date.now() < deadline) {
            const result = await call('Runtime.evaluate', {
                expression: 'window.previewReady && !document.querySelector(".resource-loading") && ({...window.previewReady, width: document.querySelector("[data-preview-dialog]").offsetWidth, height: document.querySelector("[data-preview-dialog]").offsetHeight})',
                returnByValue: true,
            });
            report = result.result.value;
            if (!report) await delay(100);
        }
        if (!report) {
            const debug = await call('Runtime.evaluate', {
                expression: 'JSON.stringify({error: window.previewError, ready: window.previewReady, document: document.readyState, root: document.getElementById("root")?.textContent.slice(0, 300)})',
                returnByValue: true,
            });
            throw Error('PckView renderer did not finish loading: ' + debug.result.value);
        }
        const {width, height} = report;
        if (width < 1 || height < 1 || width * height > 16000000) throw Error('Preview dimensions exceed capture limits');
        const {data} = await call('Page.captureScreenshot', {
            format: 'png', captureBeyondViewport: true, clip: {x: 0, y: 0, width, height, scale: 1},
        });
        process.stdout.write(JSON.stringify({report, data}));
    } finally {
        socket?.close();
        if (child.exitCode === null) {
            child.kill();
            await Promise.race([new Promise(resolve => child.once('close', resolve)), delay(2000)]);
        }
    }
}

const timeout = setTimeout(() => {
    console.error('Chromium capture timed out');
    process.exit(1);
}, 35000);
capture().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
})
    .finally(() => clearTimeout(timeout));
