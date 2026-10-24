// In-memory store. Reads and writes copy their values, so callers never share references.
export function createStore() {
  let accounts = new Map();
  let records = new Map();
  return {
    getAccount(id) {
      const account = accounts.get(id);
      return account === undefined ? undefined : structuredClone(account);
    },
    putAccount(id, account) {
      accounts.set(id, structuredClone(account));
    },
    getRecord(key) {
      const record = records.get(key);
      return record === undefined ? undefined : structuredClone(record);
    },
    putRecord(key, value) {
      records.set(key, structuredClone(value));
    },
    snapshot() {
      return { accounts: structuredClone([...accounts]), records: structuredClone([...records]) };
    },
    restore(snapshot) {
      accounts = new Map(structuredClone(snapshot.accounts));
      records = new Map(structuredClone(snapshot.records));
    },
  };
}
