const DB_NAME = "shenghuo-budget";
const DB_VERSION = 1;
const STORE = "state";
const STATE_KEY = "app-state";

let databasePromise = null;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地数据库"));
  });
  return databasePromise;
}

async function withStore(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let output;
    try {
      output = action(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      if (output && output.result !== undefined) resolve(output.result);
      else resolve(output);
    };
    tx.onerror = () => reject(tx.error || new Error("本地数据操作失败"));
    tx.onabort = () => reject(tx.error || new Error("本地数据操作中止"));
  });
}

export async function loadState() {
  const record = await withStore("readonly", (store) => store.get(STATE_KEY));
  return record ? record.value : null;
}

export async function saveState(state) {
  await withStore("readwrite", (store) => store.put({ key: STATE_KEY, value: state, savedAt: new Date().toISOString() }));
  return state;
}

export async function clearState() {
  await withStore("readwrite", (store) => store.delete(STATE_KEY));
}

export async function requestPersistentStorage() {
  if (!navigator.storage || typeof navigator.storage.persist !== "function") return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
