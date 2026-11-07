import type {SearchOutcome} from "./search-types";

function historyDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('pwforge-search', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('results');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function readHistory(): Promise<SearchOutcome | undefined> {
    const db = await historyDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction('results').objectStore('results').get('last');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

export async function writeHistory(result: SearchOutcome): Promise<void> {
    const db = await historyDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction('results', 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
            transaction.objectStore('results').put(result, 'last');
        });
    } finally {
        db.close();
    }
}

